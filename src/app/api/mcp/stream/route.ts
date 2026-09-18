import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { resolveOrgFromApiKey } from "@/lib/auth";
import { requestOrigin } from "@/lib/request-origin";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import {
  listPages,
  readPageYaml,
  writePage,
  getAnnotations,
  getPageSections,
  saveAnnotation,
  updateAnnotationStatus,
  searchPages,
  bumpViewCount,
  restorePageVersion,
} from "@/lib/pages";
import { checkFolderBoundary } from "@/lib/access";
import { resolveRules, detectFolderCycle } from "@/lib/content-rules";
import {
  getPageConcepts,
  getPageLinks,
  getVocabulary,
  getRelated,
  getSemanticMap,
  getDependents,
  VERIFY_STATUSES,
  CONCEPT_RELS,
} from "@/lib/concepts";
import { ensureComponentIds, buildOutline, formatOutline } from "@/lib/component-ids";
import { dispatch } from "@/lib/mcp-dispatch";
import { toolDescription } from "@/lib/mcp-guidance";
import { formatWarningsBlock, type ShapeWarning } from "@/lib/kazam";
import { ensureSeedPages } from "@/lib/seed";
import yaml from "js-yaml";

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

function validateSlug(slug: string | undefined): string {
  if (!slug) throw new Error("slug is required");
  if (!SLUG_RE.test(slug)) throw new Error("invalid slug format");
  return slug;
}

async function resolveAuth(request: Request) {
  if ((process.env.AUTH_MODE ?? "none") === "none") {
    const org = await db.organization.findFirst({ orderBy: { createdAt: "asc" } });
    if (!org) return null;
    return { orgId: org.id, orgSlug: org.slug, actorId: "noauth", userId: "default" };
  }

  if (process.env.AUTH_MODE === "tailscale") {
    const tsLogin = request.headers.get("tailscale-user-login");
    const devUser = process.env.NODE_ENV === "development" ? process.env.TAILSCALE_DEV_USER : null;
    if (tsLogin || devUser) {
      const { resolveOrg } = await import("@/lib/auth");
      const orgCtx = await resolveOrg();
      if (orgCtx) {
        return { orgId: orgCtx.orgId, orgSlug: orgCtx.orgSlug, actorId: `ts:${tsLogin || devUser}`, userId: orgCtx.userId };
      }
    }
  }

  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;

  // Curata API keys are always `ck_`-prefixed; anything else in clerk mode is
  // treated as a Clerk OAuth access token (MCP connector flow).
  if (process.env.AUTH_MODE === "clerk" && !token.startsWith("ck_")) {
    const { resolveOrgFromClerkOAuth } = await import("@/lib/auth");
    const oauth = await resolveOrgFromClerkOAuth(token);
    if (!oauth) return null;
    return { orgId: oauth.orgId, orgSlug: oauth.orgSlug, actorId: oauth.keyPrefix, userId: oauth.userId };
  }

  const result = await resolveOrgFromApiKey(token);
  if (!result) return null;
  return { orgId: result.orgId, orgSlug: result.orgSlug, actorId: result.keyPrefix || "apikey", userId: result.userId };
}

/**
 * Org-derived server instructions (base behavior + brain map + org rules) for
 * the initialize response. Instructions only surface in the initialize
 * result, and this transport builds a fresh server per request — so the map
 * queries run only when the request actually is an initialize, not on every
 * tool call. Best-effort: a failure here must never block the connection.
 */
async function serverInstructions(request: Request, orgId: string, orgSlug: string): Promise<string | undefined> {
  try {
    const body: unknown = await request.clone().json();
    const method = typeof body === "object" && body !== null ? (body as { method?: unknown }).method : undefined;
    if (method !== "initialize") return undefined;
    const { buildServerInstructions } = await import("@/lib/mcp-instructions");
    return await buildServerInstructions(orgId, orgSlug);
  } catch {
    return undefined;
  }
}

/**
 * RFC 9728: a 401 from a protected MCP resource advertises where its
 * protected-resource metadata lives so OAuth-capable clients (Claude.ai,
 * ChatGPT connectors) can discover the authorization server and start the
 * flow. Only meaningful in clerk mode; other modes keep the plain 401.
 */
function unauthorizedHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.AUTH_MODE === "clerk") {
    const origin = requestOrigin(request);
    headers["WWW-Authenticate"] = `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`;
  }
  return headers;
}

function createMcpServer(orgId: string, orgSlug: string, actorId: string, userId?: string, instructions?: string): McpServer {
  const server = new McpServer({ name: "curata", version: "0.1.0" }, instructions ? { instructions } : undefined);

  // Tools below that have no bespoke streaming handler delegate to the shared
  // dispatch registry so this transport stays at parity with /api/mcp.
  const viaDispatch = (tool: string) => async (rawArgs: Record<string, unknown>) => {
    const args: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawArgs)) {
      if (v !== undefined && v !== null) args[k] = String(v);
    }
    try {
      const result = await dispatch(tool, args, orgId, orgSlug, actorId, userId);
      const body = typeof result === "string" ? result : JSON.stringify(result, null, 2);
      const warnings = result && typeof result === "object" && Array.isArray((result as { shapeWarnings?: unknown }).shapeWarnings)
        ? (result as { shapeWarnings: ShapeWarning[] }).shapeWarnings
        : [];
      // JSON-RPC over HTTP is always 200, so the "not plain success" signal
      // for a written-with-warnings result is the block that leads the text.
      return { content: [{ type: "text" as const, text: formatWarningsBlock(warnings) + body }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
    }
  };

  const CHANNEL_SCHEMA = z.enum(["trusted", "latest"]).optional().describe(
    "Which version to read: \"trusted\" (default) serves the version a human pinned via markTrusted, falling back to latest (labeled trusted: false) when nothing's been marked yet. \"latest\" always serves the newest version regardless of trust."
  );

  server.tool("search_pages", "Search this organization's validated knowledge brain: approved customer answers, how-things-work pages, best practices. Call this FIRST, before answering from general knowledge, whenever a question touches this organization's product, customers, pricing, or internal process — an approved answer may already exist", { query: z.string(), channel: CHANNEL_SCHEMA }, async ({ query, channel }) => {
    const results = await searchPages(orgId, query, userId, {}, channel ?? "trusted");
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  });

  server.tool("list_pages", "List all pages", { channel: CHANNEL_SCHEMA }, async ({ channel }) => {
    const [pages, folders] = await Promise.all([
      listPages(orgId, userId, channel ?? "trusted"),
      db.folder.findMany({ where: { orgId }, select: { id: true, name: true } }),
    ]);
    const folderMap = new Map(folders.map((f) => [f.id, f.name]));
    const result = pages.map((p) => ({ ...p, folderName: p.folderId ? folderMap.get(p.folderId) ?? null : null }));
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  });

  server.tool("read_page", "Read a knowledge page's full content by slug. Use after search_pages or get_related surfaces a promising page — the full page carries caveats and provenance the search snippet omits. The response includes an outline (id, type, path, label per component, nested ids included): pick an id there and use read_component / write_component to change one part of the page instead of rewriting it.", { slug: z.string(), channel: CHANNEL_SCHEMA }, async ({ slug, channel }) => {
    validateSlug(slug);
    // Orgs created before a seed page existed (batch-2 skills, FDE skills)
    // never got it — backfill missing seed pages here so a thin-pointer
    // SKILL.md doesn't 404. See ensureSeedPages in src/lib/seed.ts.
    await ensureSeedPages(orgId);
    const result = await readPageYaml(orgId, slug, channel ?? "trusted");
    if (!result) return { content: [{ type: "text", text: `Error: page not found: ${slug}` }], isError: true };

    const parsed = yaml.load(result.yaml) as Record<string, unknown>;
    let outline: ReturnType<typeof buildOutline> = [];
    if (Array.isArray(parsed.components)) {
      parsed.components = ensureComponentIds(parsed.components as Record<string, unknown>[]);
      outline = buildOutline(parsed.components as Record<string, unknown>[]);
      result.yaml = yaml.dump(parsed, { lineWidth: -1, noRefs: true });
    }

    const page = await db.page.findUnique({
      where: { orgId_slug: { orgId, slug } },
      select: { id: true, folderId: true, rules: true, visibility: true },
    });

    const [sections, annotations] = await Promise.all([
      getPageSections(orgId, slug, channel ?? "trusted"),
      getAnnotations(orgId, slug),
    ]);

    const concepts = page ? await getPageConcepts(page.id) : [];
    const links = page ? await getPageLinks(orgId, page.id) : [];
    if (page) {
      bumpViewCount(page.id).catch(() => {});
    }

    const rules = await resolveRules(orgId, page?.folderId ?? null, page?.rules);
    const visibleRules = page?.visibility === "public"
      ? rules.page
      : [...rules.inherited, ...rules.page];
    const response: Record<string, unknown> = {
      slug,
      yaml: result.yaml,
      contentHash: result.contentHash,
      outline: outline.map((e) => ({ id: e.id, type: e.type, path: e.path, depth: e.depth, parentId: e.parentId, label: e.label })),
      outlineText: formatOutline(outline),
      sections,
      annotations,
      concepts,
      links,
      trusted: result.trusted,
      trustedBehind: result.trustedBehind,
    };
    if (visibleRules.length > 0) {
      response.contentRules = visibleRules.map((r) => ({ id: r.id, text: r.text, mode: r.mode, scope: r.scope }));
    }

    return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
  });

  server.tool("write_page", toolDescription("write_page", "Create or update a page"),
    { slug: z.string(), content: z.string(), folder_id: z.string().optional(), visibility: z.enum(["private", "org", "public"]).optional().describe("Page visibility — defaults to private for authenticated users, org for no-auth"), sort_order: z.number().int().optional().describe("Explicit sort position within folder (lower = first). Null/omitted = sort after ordered pages."), concepts: z.string().optional().describe('JSON array of concept objects: [{term, kind?, section?, rel?, remove?}]. Terms are slugs (lowercase letters, digits, hyphens), with one optional / namespace like feature/gcp-support. rel (optional): how the page relates to the concept. depends = page is wrong if the concept changes; asserts = page is the source of truth for the concept; references = plain mention (default). Omit rel on an existing tag to leave it unchanged. Curated kinds: topic (default), vendor, finding, framework, template — call get_vocabulary to see kinds in use. remove: true detaches the tag from this page. Supplying kind on an existing term re-kinds the concept everywhere it is used.'), links: z.string().optional().describe("JSON array of link objects: [{target, rel, description?}]"), capture_token: z.string().optional().describe("Required when creating a page whose pageType has captureRequired: true — the token capture_thread returned"), dedup_ack: z.string().optional().describe('Required alongside capture_token: "new", or the candidate slug capture_thread should redirect you to patch_page instead') },
    viaDispatch("write_page"));

  server.tool("read_component", toolDescription("read_component", "Read one component from a page by id"),
    { slug: z.string().describe("Page slug"), id: z.string().describe("Component id from read_page's outline (nested ids work)"), channel: CHANNEL_SCHEMA },
    viaDispatch("read_component"));

  server.tool("write_component", toolDescription("write_component", "Replace one component on a page by id"),
    {
      slug: z.string().describe("Page slug"),
      id: z.string().describe("Component id to replace (from read_page outline or read_component)"),
      yaml: z.string().describe("YAML for the single replacement component, starting with type:. The id is kept."),
      component_hash: z.string().optional().describe("componentHash from read_component; the write is refused if that component changed since"),
      expected_hash: z.string().optional().describe("Page contentHash from read_page; refused if the page changed since"),
    },
    viaDispatch("write_component"));

  server.tool("patch_page", toolDescription("patch_page", "Apply targeted operations to a page without rewriting full YAML"),
    {
      slug: z.string().describe("Page slug"),
      expected_hash: z.string().optional().describe("Content hash from last read_page — rejects if page was modified. Required when operations are given."),
      operations: z.string().optional().describe('JSON array of operations. Each operation has: "op" (required), "id" (required for replace/insert_before/insert_after/remove — the component ID to target), "components" or "value" (the new component(s) — required for all ops except remove and set_field), "field" (required for set_field). Example: [{"op":"insert_after","id":"intro-section","components":[{"type":"text","body":"New content"}]}]'),
      concepts: z.string().optional().describe('JSON array of concept objects: [{term, kind?, section?, rel?, remove?}]. Terms are slugs (lowercase letters, digits, hyphens), with one optional / namespace like feature/gcp-support. rel (optional): how the page relates to the concept. depends = page is wrong if the concept changes; asserts = page is the source of truth for the concept; references = plain mention (default). Omit rel on an existing tag to leave it unchanged. Curated kinds: topic (default), vendor, finding, framework, template. remove: true detaches the tag from this page. Supplying kind on an existing term re-kinds the concept everywhere it is used.'),
      links: z.string().optional().describe("JSON array of link objects: [{target, rel, description?}]"),
    },
    viaDispatch("patch_page"));

  server.tool("create_page", toolDescription("create_page", "Create a new knowledge page in the brain"),
    { slug: z.string(), content: z.string(), folder_id: z.string().optional(), visibility: z.enum(["private", "org", "public"]).optional().describe("Page visibility — defaults to private for authenticated users, org for no-auth"), sort_order: z.number().int().optional().describe("Explicit sort position within folder (lower = first). Null/omitted = sort after ordered pages."), concepts: z.string().optional().describe('JSON array of concept objects: [{term, kind?, section?, rel?}]. Terms are slugs (lowercase letters, digits, hyphens), with one optional / namespace like feature/gcp-support. rel (optional): how the page relates to the concept. depends = page is wrong if the concept changes; asserts = page is the source of truth for the concept; references = plain mention (default). Omit rel on an existing tag to leave it unchanged. Curated kinds: topic (default), vendor, finding, framework, template.'), links: z.string().optional().describe("JSON array of link objects: [{target, rel, description?}]"), capture_token: z.string().optional().describe("Required when creating a page whose pageType has captureRequired: true — the token capture_thread returned"), dedup_ack: z.string().optional().describe('Required alongside capture_token: "new", or the candidate slug capture_thread should redirect you to patch_page instead') },
    viaDispatch("create_page"));

  server.tool("list_folders", "List all folders", {}, async () => {
    const folders = await db.folder.findMany({
      where: { orgId }, orderBy: { name: "asc" },
      include: { _count: { select: { pages: true } } },
    });
    const result = folders.map((f) => ({ id: f.id, name: f.name, parentId: f.parentId, visibility: f.visibility, pageCount: f._count.pages }));
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  });

  server.tool("get_folder_structure", "Get full folder tree with pages", {}, async () => {
    const [folders, pages] = await Promise.all([
      db.folder.findMany({ where: { orgId }, orderBy: { name: "asc" }, include: { _count: { select: { pages: true } } } }),
      listPages(orgId),
    ]);
    return { content: [{ type: "text", text: JSON.stringify({ folders: folders.map((f) => ({ id: f.id, name: f.name, parentId: f.parentId, pageCount: f._count.pages })), pages: pages.map((p) => ({ slug: p.slug, title: p.title, folderId: p.folderId })) }, null, 2) }] };
  });

  server.tool("create_folder", "Create a new folder",
    { name: z.string(), parent_id: z.string().optional(), visibility: z.enum(["org", "private"]).optional() },
    async ({ name, parent_id, visibility }) => {
      if (parent_id) {
        const parent = await db.folder.findFirst({ where: { id: parent_id, orgId } });
        if (!parent) return { content: [{ type: "text", text: `Error: parent folder not found: ${parent_id}` }], isError: true };
      }
      const folder = await db.folder.create({
        data: { orgId, name, visibility: visibility ?? "org", createdBy: actorId, parentId: parent_id ?? null },
      });
      logAudit({ orgId, action: "folder.create", resourceType: "folder", resourceId: folder.id, actorType: "apikey", actorId, metadata: { name, parentId: parent_id } });
      return { content: [{ type: "text", text: `Created folder "${name}" (id: ${folder.id})` }] };
    });

  server.tool("update_folder", "Rename, reparent, or change visibility of a folder",
    { id: z.string(), name: z.string().optional(), parent_id: z.string().nullable().optional(), visibility: z.enum(["org", "private"]).optional() },
    async ({ id, name, parent_id, visibility }) => {
      const folder = await db.folder.findFirst({ where: { id, orgId } });
      if (!folder) return { content: [{ type: "text", text: `Error: folder not found: ${id}` }], isError: true };
      if (parent_id) {
        const parent = await db.folder.findFirst({ where: { id: parent_id, orgId } });
        if (!parent) return { content: [{ type: "text", text: `Error: parent folder not found: ${parent_id}` }], isError: true };
        const wouldCycle = await detectFolderCycle(orgId, id, parent_id);
        if (wouldCycle) return { content: [{ type: "text", text: "Error: cannot reparent: would create a cycle" }], isError: true };
      }
      if (visibility) {
        const pagesInFolder = await db.page.findMany({
          where: { folderId: id },
          select: { slug: true, visibility: true },
        });
        const violating = pagesInFolder.filter((p) => {
          try { checkFolderBoundary(p.visibility ?? "org", visibility); return false; } catch { return true; }
        });
        if (violating.length > 0) {
          return { content: [{ type: "text", text: `Error: cannot set folder to "${visibility}" — ${violating.length} page(s) have lower visibility: ${violating.map((p) => p.slug).join(", ")}` }], isError: true };
        }
      }
      const data: Record<string, unknown> = {};
      if (name !== undefined) data.name = name;
      if (parent_id !== undefined) data.parentId = parent_id;
      if (visibility !== undefined) data.visibility = visibility;
      await db.folder.update({ where: { id }, data });
      logAudit({ orgId, action: "folder.update", resourceType: "folder", resourceId: id, actorType: "apikey", actorId, metadata: { name, parentId: parent_id, visibility } });
      return { content: [{ type: "text", text: `Updated folder "${folder.name}"` }] };
    });

  server.tool("restore_page_version", "Restore a page to a previous version",
    { slug: z.string(), version_id: z.string() },
    async ({ slug, version_id }) => {
      validateSlug(slug);
      // Routed through the same write choke point as write_page/patch_page
      // (see restorePageVersion in @/lib/pages) so a restore restamps
      // tokenCount, is subject to the brain-cap check (shrinking always
      // passes, growing past cap is rejected), and prunes old versions —
      // identical semantics to any other write.
      const result = await restorePageVersion(orgId, orgSlug, slug, version_id, actorId);
      if (!result.ok) return { content: [{ type: "text", text: `Error: ${result.error}` }], isError: true };
      logAudit({ orgId, action: "page.restore", resourceType: "page", resourceId: slug, actorType: "apikey", actorId, metadata: { slug, versionId: version_id } });
      return { content: [{ type: "text", text: `Restored "${slug}" to version ${version_id}` }] };
    });

  server.tool("replace_in_page", "Find and replace text in a page's YAML source",
    { slug: z.string(), target: z.string(), replacement: z.string() },
    async ({ slug, target, replacement }) => {
      validateSlug(slug);
      const page = await readPageYaml(orgId, slug);
      if (!page) return { content: [{ type: "text", text: `Error: page not found: ${slug}` }], isError: true };
      let yamlTarget = target;
      if (!page.yaml.includes(target)) {
        // Try case-insensitive
        const lowerYaml = page.yaml.toLowerCase();
        const lowerTarget = target.toLowerCase();
        const ciIdx = lowerYaml.indexOf(lowerTarget);
        if (ciIdx !== -1) {
          yamlTarget = page.yaml.slice(ciIdx, ciIdx + target.length);
        } else {
          // Try multiline flexible whitespace
          const lines = target.split("\n");
          if (lines.length > 1) {
            const pattern = new RegExp(lines.map((l) => l.trimStart().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\n\\s*"), "i");
            const m = page.yaml.match(pattern);
            if (m) yamlTarget = m[0];
            else return { content: [{ type: "text", text: "Error: target text not found in page source" }], isError: true };
          } else {
            return { content: [{ type: "text", text: "Error: target text not found in page source" }], isError: true };
          }
        }
      }
      const occurrences = page.yaml.split(yamlTarget).length - 1;
      if (occurrences > 1) return { content: [{ type: "text", text: `Error: target text is ambiguous — found ${occurrences} occurrences` }], isError: true };
      const newContent = page.yaml.replace(yamlTarget, replacement);
      const result = await writePage(orgId, orgSlug, slug, newContent, userId || "agent", page.contentHash);
      if (!result.ok) return { content: [{ type: "text", text: `Error: ${result.error}` }], isError: true };
      logAudit({ orgId, action: "page.replace", resourceType: "page", resourceId: slug, actorType: "apikey", actorId, metadata: { slug } });
      return { content: [{ type: "text", text: `Replaced text in "${slug}"` }] };
    });

  server.tool("move_page", "Move a page to a folder",
    { slug: z.string(), folder_id: z.string().optional() },
    async ({ slug, folder_id }) => {
      validateSlug(slug);
      const page = await db.page.findUnique({ where: { orgId_slug: { orgId, slug } } });
      if (!page) return { content: [{ type: "text", text: `Error: page not found: ${slug}` }], isError: true };
      const folderId = folder_id || null;
      if (folderId) {
        const folder = await db.folder.findFirst({ where: { id: folderId, orgId } });
        if (!folder) return { content: [{ type: "text", text: `Error: folder not found: ${folderId}` }], isError: true };
        try { checkFolderBoundary(page.visibility ?? "org", folder.visibility); } catch (e) {
          return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
        }
      }
      await db.page.update({ where: { id: page.id }, data: { folderId } });
      logAudit({ orgId, action: "page.move", resourceType: "page", resourceId: slug, actorType: "apikey", actorId, metadata: { slug, folderId } });
      return { content: [{ type: "text", text: `Moved "${slug}" to ${folderId ? `folder ${folderId}` : "no folder"}` }] };
    });

  server.tool("annotate_page", "Add an annotation to a page",
    {
      slug: z.string(),
      text: z.string(),
      section: z.string().optional(),
      kind: z.enum(["note", "edit"]).optional(),
      replacement: z.string().optional(),
      source: z.enum(["agent", "prescreen"]).optional().describe('Provenance tag: "prescreen" marks a review pre-screen finding, defaults to "agent"'),
    },
    async ({ slug, text, section, kind, replacement, source }) => {
      validateSlug(slug);
      const annotation = await saveAnnotation(orgId, orgSlug, slug, text, "agent", section, undefined, kind, replacement, source ?? "agent");
      logAudit({ orgId, action: "annotation.create", resourceType: "annotation", resourceId: (annotation as { id?: string }).id ?? slug, actorType: "apikey", actorId, metadata: { slug, section, kind } });
      return { content: [{ type: "text", text: `Annotation added to "${slug}"` }] };
    });

  server.tool("update_annotation", "Update annotation status",
    { slug: z.string(), id: z.string(), status: z.enum(["approved", "ignored", "incorporated"]) },
    async ({ slug, id, status }) => {
      validateSlug(slug);
      const updated = await updateAnnotationStatus(orgId, orgSlug, slug, id, status);
      if (!updated) return { content: [{ type: "text", text: "Error: annotation not found" }], isError: true };
      logAudit({ orgId, action: "annotation.update", resourceType: "annotation", resourceId: id, actorType: "apikey", actorId, metadata: { slug, status } });
      return { content: [{ type: "text", text: `Annotation ${id} marked as ${status}` }] };
    });

  server.tool("get_component_reference", toolDescription("get_component_reference", "Get YAML component authoring guide"),
    { component: z.string().optional().describe("Component type (graph, pipeline, grid, box, sequence, chart, ...). Returns a short slice: when to use it, a curated example to copy, and the shape rules. Omit for the full reference.") },
    viaDispatch("get_component_reference"));

  server.tool("get_vocabulary", "Get all concept terms in the knowledge graph, optionally filtered by kind or search query",
    { kind: z.string().optional(), query: z.string().optional() },
    async ({ kind, query }) => {
      const result = await getVocabulary(kind, query);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    });

  server.tool("get_related", "Get pages and concepts related to a term, tag, or page slug. Use to pull everything under a brain-map tag, or to check for existing coverage before creating a page",
    { term: z.string().optional(), slug: z.string().optional() },
    async ({ term, slug }) => {
      const result = await getRelated(orgId, { term, slug });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    });

  server.tool("map_dependencies", "Build a dependency graph around one concept in a single call: tag the page(s) that own the truth (asserts), the pages that go stale when it changes (depends), pages that merely mention it (references), and assets outside curata like a Drive deck or a GitHub README (external). Additive, never removes edges. Unknown slugs come back in `missing` instead of failing the call.",
    {
      term: z.string().describe("Concept term, namespaced with one slash: feature/investigations-grouping, pricing/tier-2, messaging/tagline"),
      kind: z.string().optional().describe("Concept kind for a new term: feature, pricing, api, process, ..."),
      asserts: z.array(z.string()).optional().describe("Slugs of the page(s) that are the source of truth for this concept"),
      depends: z.array(z.string()).optional().describe("Slugs of pages that must be re-checked when this concept changes"),
      references: z.array(z.string()).optional().describe("Slugs of pages that mention it without depending on it"),
      external: z.array(z.object({
        url: z.string().describe("Absolute http(s) URL of the asset"),
        label: z.string().optional().describe("Human name, like 'Sales deck Q3'. Defaults to host + path"),
        owner: z.string().optional().describe("Team or person who updates it"),
        rel: z.enum(CONCEPT_RELS).optional().describe("Defaults to depends"),
        remove: z.boolean().optional().describe("Detach this url from the concept"),
      })).optional().describe("Assets outside curata that go stale when the concept changes"),
    },
    async (a) => {
      // Arrays go through dispatch as JSON strings, same as concepts/links on
      // the write tools, so both transports share one code path.
      const flat: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(a)) {
        if (v === undefined) continue;
        flat[k] = typeof v === "string" ? v : JSON.stringify(v);
      }
      return viaDispatch("map_dependencies")(flat);
    });

  server.tool("mark_verified", "Record that you looked at a page or external asset with respect to a concept, without writing a new version. Default status holds: it is still right, clears staleAgainstSource. status needs_change: you looked and it is wrong, reads as 'needs update' until someone writes the page or marks it holds. Verification is per edge (page x concept): pass term to scope it, omit term to cover every concept the page or asset is tagged with.",
    {
      slug: z.string().optional().describe("Page slug to verify"),
      url: z.string().optional().describe("External asset URL to verify"),
      term: z.string().optional().describe("Scope to this page's or asset's edge to one concept. Omit to cover all its edges"),
      status: z.enum(VERIFY_STATUSES).optional().describe("holds (default) or needs_change"),
      note: z.string().optional().describe("Why it still holds, like 'does not quote the price'. Shown next to the verified badge"),
    },
    viaDispatch("mark_verified"));

  server.tool("get_dependents", "Directional dependency view for a concept or page: which pages depend on it (go stale if it changes), which page asserts it (source of truth), which pages were built from it as a template, and which external assets (Drive, GitHub, ...) hang off it. Every row carries verifiedAt and staleAgainstSource (true when the source of truth changed after that row was last verified). Call before changing something to see what else has to move, and after to see what still has not been looked at. `summary.text` is a one-line count ready to hand to a human. Unknown terms error with near matches instead of returning an empty graph.",
    { slug: z.string().optional().describe("Page slug. Returns what this page depends on (asserters), what depends on it, and its template instances"), term: z.string().optional().describe("Concept term, like pricing/tier-2. Returns asserters, dependents, and instances of the concept"), rel: z.enum(CONCEPT_RELS).optional().describe("Term mode only: restrict to one relation") },
    async ({ slug, term, rel }) => {
      if (!slug && !term) throw new Error("slug or term is required");
      const result = await getDependents(orgId, { slug, term, rel });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    });

  server.tool("get_semantic_map", "Get full knowledge graph topology — all concepts with their pages and all cross-page links",
    { kind: z.string().optional() },
    async ({ kind }) => {
      const result = await getSemanticMap(kind);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    });

  server.tool("capture_thread", "Gate 1 of capturing a raw thread/transcript: run this before create_page for a typed capture page. Returns dedup_candidates (existing pages that may already cover this), a checklist of what the target pageType requires, and a capture_token to pass to create_page/write_page along with dedup_ack.",
    {
      content: z.string().describe("The thread/transcript text to capture"),
      source: z.string().optional().describe('JSON object of source metadata, e.g. {"url": "...", "participants": ["..."], "date": "..."}'),
      page_type: z.string().optional().describe('Page type to derive the checklist for — defaults to "captured-qa"'),
      folder_id: z.string().optional().describe("Target folder, if known — used to resolve folder-scoped required-components rules"),
    },
    viaDispatch("capture_thread"));

  server.tool("get_config", "Get site configuration", {}, viaDispatch("get_config"));

  server.tool("list_annotations", "List annotations on a page",
    { slug: z.string() },
    viaDispatch("list_annotations"));

  server.tool("list_open_annotations", "Org-wide queue of annotations awaiting processing (pending/approved), grouped by page — entry point for the process-annotations workflow",
    { status: z.enum(["pending", "approved"]).optional().describe("Filter to one status; omit for both") },
    viaDispatch("list_open_annotations"));

  server.tool("flag_page", "Queue a page for cleanup (archive/delete/merge/supersede). Agent proposes, human disposes on the Cleanup view — nothing is removed until a human acts.",
    {
      slug: z.string(),
      action: z.enum(["archive", "delete", "merge", "supersede"]),
      reason: z.enum(["shipped-not-closed", "superseded", "stale", "duplicate", "one-off-expired"]),
      evidence: z.string().describe("Cite what you checked — repo paths, dates, task state"),
      confidence: z.enum(["high", "medium", "low"]).optional(),
      superseded_by: z.string().optional().describe("Slug of the replacing page — required when action is supersede"),
    },
    viaDispatch("flag_page"));

  server.tool("list_flags", "List cleanup flags — pending plus human dispositions (kept/snoozed) so sweeps avoid duplicate work",
    { status: z.enum(["pending", "kept", "snoozed", "resolved", "all"]).optional() },
    viaDispatch("list_flags"));

  server.tool("get_review_queue", "REVIEW PRE-SCREEN: pages waiting on human trust review (never-trusted pages inside an approval rule's scope, plus any page whose trusted version has fallen behind latest). Each item carries the trusted and latest version ids, the applicable approval rule description if one resolves, and the folder name. Pre-screen flow: for each item, read_page the slug on channel \"trusted\" and channel \"latest\" to diff, check list_rules for the folder, search_pages plus get_related to check for likely duplicates, validate_page for structural problems, then annotate_page one finding per issue (kind \"note\", source \"prescreen\"). Never call mark_trusted from a pre-screen: findings are advisory only, a human decides.",
    {},
    viaDispatch("get_review_queue"));

  server.tool("get_versions", "List version history for a page",
    { slug: z.string(), limit: z.string().optional().describe("Max versions to return (default 10, max 50)") },
    viaDispatch("get_versions"));

  server.tool("validate_page", "Validate page YAML without writing it",
    { slug: z.string(), content: z.string() },
    viaDispatch("validate_page"));

  server.tool("list_workflows", "List workflow pages with their trigger phrases and descriptions",
    {},
    viaDispatch("list_workflows"));

  server.tool("list_templates", "List template pages with their {{variables}}",
    {},
    viaDispatch("list_templates"));

  server.tool("create_from_template", toolDescription("create_from_template", "Create a page from a template, interpolating {{variables}}"),
    {
      template_slug: z.string(),
      target_slug: z.string(),
      variables: z.string().optional().describe("JSON object of variable values, e.g. {\"company\": \"Acme\"}"),
      folder_id: z.string().optional(),
    },
    viaDispatch("create_from_template"));

  server.tool("export_page", "Export a single page as PNG or PDF",
    {
      slug: z.string().describe("Page slug to export"),
      format: z.enum(["png", "pdf"]).describe("Output format"),
    },
    viaDispatch("export_page"));

  server.tool("export_report", "Generate a grouped PDF report combining multiple pages with a title page and appendix",
    {
      slugs: z.string().describe("JSON array of page slugs to include, in order"),
      title: z.string().describe("Report title for the cover page"),
      subtitle: z.string().optional().describe("Subtitle for the cover page"),
    },
    viaDispatch("export_report"));

  server.tool("list_rules", "List content rules for a page (cascaded from global + folder + page) or global rules if no slug",
    { slug: z.string().optional().describe("Page slug to resolve cascaded rules for; omit for global rules only") },
    viaDispatch("list_rules"));

  server.tool("set_rules", "Set content rules at a scope (global, folder, or page). Rules are JSON arrays of {id, text, mode, patterns?}",
    {
      scope: z.enum(["global", "folder", "page"]).describe("Where to set rules"),
      scope_id: z.string().optional().describe("Folder ID (scope=folder) or page slug (scope=page); omit for global"),
      rules: z.string().describe("JSON array of rule objects: [{id, text, mode: 'warn'|'block', patterns?: string[]}]"),
    },
    viaDispatch("set_rules"));

  server.tool("list_groups", "List org groups with their members. Groups are a many-to-many primitive (a user can be in several groups) for future features like folder approval groups and per-group digests — read-only here.",
    {},
    viaDispatch("list_groups"));

  server.tool("create_group", "Create a group. Owner/admin only.",
    { name: z.string() },
    viaDispatch("create_group"));

  server.tool("update_group", "Rename a group. Owner/admin only.",
    { group_id: z.string(), name: z.string() },
    viaDispatch("update_group"));

  server.tool("delete_group", "Delete a group (and its memberships). Owner/admin only.",
    { group_id: z.string() },
    viaDispatch("delete_group"));

  server.tool("add_group_member", "Add one or many members to a group by user ID. Owner/admin only.",
    {
      group_id: z.string(),
      user_ids: z.string().describe("JSON array or comma-separated list of user IDs to add"),
      role: z.enum(["member", "owner"]).optional().describe("Group-level role for the added member(s) — defaults to member"),
    },
    viaDispatch("add_group_member"));

  server.tool("remove_group_member", "Remove a member from a group. Owner/admin only.",
    { group_id: z.string(), user_id: z.string() },
    viaDispatch("remove_group_member"));

  server.tool("mark_trusted", "Pin a page version as the human-approved \"trusted\" read (npm dist-tag style). Only succeeds if the calling key's human is eligible under the page's approval rule (same check as the dashboard's Mark trusted button) — errors naming the rule otherwise. Always confirm with your human before calling this.",
    { slug: z.string(), version_id: z.string().optional().describe("Version to trust; defaults to the page's latest version") },
    viaDispatch("mark_trusted"));

  server.tool("clear_trusted", "Clear a page's trusted pointer — reads on the \"trusted\" channel fall back to latest (labeled untrusted) until a human marks a version again. Same eligibility gate as mark_trusted.",
    { slug: z.string() },
    viaDispatch("clear_trusted"));

  server.tool("generate_digest", "Generate (or refresh) this org's dated digest page: One big thing (a human-picked headline), Noteworthy (2-3 short items), and Activity (stats plus hot spots) since the last digest run. Call with preview: true first to get the window's gathered data (candidate pages, counts) without writing anything - read a few of those pages, draft candidates, and gate on a human pick before calling again with big_thing/noteworthy to write the page. Writes to a deterministic per-week slug in the Digests folder - running it again mid-week updates that same page instead of creating a duplicate. Weekly cadence is a guideline, not enforced.",
    {
      preview: z.boolean().optional().describe("When true, return the gathered window data (new pages by concept, trust flips, awaiting review, hot spots, the slug this run would write) without writing a page. big_thing/noteworthy are ignored in this mode."),
      big_thing: z.string().optional().describe('JSON object for the week\'s single biggest item, normally the human\'s pick: {headline (<=80 chars), body (1-3 sentences), slug? (link this to an existing page - must exist and be visible to this caller), also_considered? (array of other candidate headlines - only set on unattended runs where no human picked)}'),
      noteworthy: z.string().optional().describe('JSON array of at most 3 items: [{summary (2-5 words, <=40 chars), description (one sentence, <=200 chars), slug (existing, visible page)}]'),
    },
    viaDispatch("generate_digest"));

  return server;
}

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const ctx = await resolveAuth(request);
  if (!ctx) {
    return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "unauthorized — in tailscale auth mode, identity headers only exist on the https:// Tailscale-served URL (plain http:// always 401s); otherwise pass Authorization: Bearer <api key>" }, id: null }), {
      status: 401, headers: unauthorizedHeaders(request),
    });
  }

  const server = createMcpServer(ctx.orgId, ctx.orgSlug, ctx.actorId, ctx.userId, await serverInstructions(request, ctx.orgId, ctx.orgSlug));
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  return transport.handleRequest(request);
}

export async function GET(request: Request) {
  const ctx = await resolveAuth(request);
  if (!ctx) {
    return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "unauthorized — in tailscale auth mode, identity headers only exist on the https:// Tailscale-served URL (plain http:// always 401s); otherwise pass Authorization: Bearer <api key>" }, id: null }), {
      status: 401, headers: unauthorizedHeaders(request),
    });
  }

  const server = createMcpServer(ctx.orgId, ctx.orgSlug, ctx.actorId, ctx.userId, await serverInstructions(request, ctx.orgId, ctx.orgSlug));
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  return transport.handleRequest(request);
}

export async function DELETE(request: Request) {
  return new Response(null, { status: 405 });
}
