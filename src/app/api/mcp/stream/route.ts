import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { resolveOrgFromApiKey } from "@/lib/auth";
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
} from "@/lib/pages";
import { validateContent, checkUnsupportedComponents } from "@/lib/kazam";
import {
  upsertConcepts,
  upsertLinks,
  getPageConcepts,
  getPageLinks,
  getVocabulary,
  getRelated,
  getSemanticMap,
} from "@/lib/concepts";
import type { ConceptInput, LinkInput } from "@/lib/concepts";
import { ensureComponentIds, applyPatchOperations } from "@/lib/component-ids";
import type { PatchOperation } from "@/lib/component-ids";
import { dispatch } from "@/lib/mcp-dispatch";
import yaml from "js-yaml";
import { createHash } from "crypto";
import fs from "fs";
import path from "path";

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
  const result = await resolveOrgFromApiKey(token);
  if (!result) return null;
  return { orgId: result.orgId, orgSlug: result.orgSlug, actorId: result.keyPrefix || "apikey", userId: result.userId };
}

function createMcpServer(orgId: string, orgSlug: string, actorId: string, userId?: string): McpServer {
  const server = new McpServer({ name: "curata", version: "0.1.0" });

  // Tools below that have no bespoke streaming handler delegate to the shared
  // dispatch registry so this transport stays at parity with /api/mcp.
  const viaDispatch = (tool: string) => async (rawArgs: Record<string, unknown>) => {
    const args: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawArgs)) {
      if (v !== undefined && v !== null) args[k] = String(v);
    }
    try {
      const result = await dispatch(tool, args, orgId, orgSlug, actorId, userId);
      const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
      return { content: [{ type: "text" as const, text }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
    }
  };

  server.tool("search_pages", "Search the knowledge base", { query: z.string() }, async ({ query }) => {
    const results = await searchPages(orgId, query, userId);
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  });

  server.tool("list_pages", "List all pages", {}, async () => {
    const [pages, folders] = await Promise.all([
      listPages(orgId, userId),
      db.folder.findMany({ where: { orgId }, select: { id: true, name: true } }),
    ]);
    const folderMap = new Map(folders.map((f) => [f.id, f.name]));
    const result = pages.map((p) => ({ ...p, folderName: p.folderId ? folderMap.get(p.folderId) ?? null : null }));
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  });

  server.tool("read_page", "Read a page by slug", { slug: z.string() }, async ({ slug }) => {
    validateSlug(slug);
    const result = await readPageYaml(orgId, slug);
    if (!result) return { content: [{ type: "text", text: `Error: page not found: ${slug}` }], isError: true };

    const parsed = yaml.load(result.yaml) as Record<string, unknown>;
    if (Array.isArray(parsed.components)) {
      parsed.components = ensureComponentIds(parsed.components as Record<string, unknown>[]);
      result.yaml = yaml.dump(parsed, { lineWidth: -1, noRefs: true });
    }

    const sections = await getPageSections(orgId, slug);
    const annotations = await getAnnotations(orgId, slug);

    const page = await db.page.findUnique({
      where: { orgId_slug: { orgId, slug } },
      select: { id: true },
    });
    const concepts = page ? await getPageConcepts(page.id) : [];
    const links = page ? await getPageLinks(orgId, page.id) : [];
    if (page) {
      bumpViewCount(page.id).catch(() => {});
    }

    return { content: [{ type: "text", text: JSON.stringify({ slug, yaml: result.yaml, contentHash: result.contentHash, sections, annotations, concepts, links }, null, 2) }] };
  });

  server.tool("write_page", "Create or update a page",
    { slug: z.string(), content: z.string(), folder_id: z.string().optional(), sort_order: z.number().int().optional().describe("Explicit sort position within folder (lower = first). Null/omitted = sort after ordered pages."), concepts: z.string().optional().describe("JSON array of concept objects: [{term, kind?, section?}]"), links: z.string().optional().describe("JSON array of link objects: [{target, rel, description?}]") },
    async ({ slug, content, folder_id, sort_order, concepts: conceptsJson, links: linksJson }) => {
      validateSlug(slug);
      const unsupported = checkUnsupportedComponents(content);
      if (unsupported.length > 0) return { content: [{ type: "text", text: `Error: ${unsupported.map((e) => e.message).join("; ")}` }], isError: true };
      const validationErrors = await validateContent(orgSlug, slug, content);
      if (validationErrors.length > 0) return { content: [{ type: "text", text: `Error: invalid YAML: ${validationErrors.map((e) => e.message).join("; ")}` }], isError: true };
      const result = await writePage(orgId, orgSlug, slug, content, userId || "agent", undefined, sort_order, "org");
      if (!result.ok) return { content: [{ type: "text", text: `Error: ${result.error}` }], isError: true };
      if (folder_id) {
        await db.page.update({ where: { orgId_slug: { orgId, slug } }, data: { folderId: folder_id } });
      }
      if (conceptsJson || linksJson) {
        const wpPage = await db.page.findUnique({ where: { orgId_slug: { orgId, slug } } });
        if (wpPage) {
          if (conceptsJson) {
            const conceptInputs: ConceptInput[] = JSON.parse(conceptsJson);
            await upsertConcepts(wpPage.id, conceptInputs, actorId);
          }
          if (linksJson) {
            const linkInputs: LinkInput[] = JSON.parse(linksJson);
            await upsertLinks(orgId, wpPage.id, linkInputs, actorId);
          }
        }
      }
      logAudit({ orgId, action: "page.write", resourceType: "page", resourceId: slug, actorType: "apikey", actorId, metadata: { slug } });
      return { content: [{ type: "text", text: `Updated page "${slug}"` }] };
    });

  server.tool("patch_page", "Apply targeted operations to a page without rewriting full YAML. Requires component IDs from read_page.",
    {
      slug: z.string().describe("Page slug"),
      expected_hash: z.string().describe("Content hash from last read_page — rejects if page was modified"),
      operations: z.string().describe('JSON array of operations. Each operation has: "op" (required), "id" (required for replace/insert_before/insert_after/remove — the component ID to target), "components" or "value" (the new component(s) — required for all ops except remove and set_field), "field" (required for set_field). Example: [{"op":"insert_after","id":"intro-section","components":[{"type":"text","body":"New content"}]}]'),
    },
    async ({ slug, expected_hash, operations: opsJson }) => {
      validateSlug(slug);

      let operations: PatchOperation[];
      try {
        operations = JSON.parse(opsJson);
      } catch {
        return { content: [{ type: "text", text: "Error: operations must be valid JSON" }], isError: true };
      }
      if (!Array.isArray(operations)) {
        return { content: [{ type: "text", text: "Error: operations must be an array" }], isError: true };
      }

      const current = await readPageYaml(orgId, slug);
      if (!current) return { content: [{ type: "text", text: `Error: page not found: ${slug}` }], isError: true };

      if (current.contentHash !== expected_hash) {
        return { content: [{ type: "text", text: `Error: conflict — page modified since last read (current hash: ${current.contentHash})` }], isError: true };
      }

      const parsed = yaml.load(current.yaml) as Record<string, unknown>;
      if (!Array.isArray(parsed.components)) {
        return { content: [{ type: "text", text: "Error: page has no components array — use write_page instead" }], isError: true };
      }

      try {
        parsed.components = ensureComponentIds(parsed.components as Record<string, unknown>[]);
        const patched = applyPatchOperations(parsed as { components: Record<string, unknown>[]; [k: string]: unknown }, operations);
        patched.components = ensureComponentIds(patched.components);

        const newYaml = yaml.dump(patched, { lineWidth: -1, noRefs: true });

        const unsupported = checkUnsupportedComponents(newYaml);
        if (unsupported.length > 0) return { content: [{ type: "text", text: `Error: ${unsupported.map((e) => e.message).join("; ")}` }], isError: true };
        const validationErrors = await validateContent(orgSlug, slug, newYaml);
        if (validationErrors.length > 0) return { content: [{ type: "text", text: `Error: invalid after patch: ${validationErrors.map((e) => e.message).join("; ")}` }], isError: true };

        const result = await writePage(orgId, orgSlug, slug, newYaml, userId || "agent", current.contentHash);
        if (!result.ok) return { content: [{ type: "text", text: `Error: ${result.error}` }], isError: true };

        logAudit({ orgId, action: "page.patch", resourceType: "page", resourceId: slug, actorType: "apikey", actorId, metadata: { slug, operationCount: operations.length } });
        return { content: [{ type: "text", text: `Patched "${slug}" (${operations.length} operations applied)` }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
      }
    });

  server.tool("create_page", "Create a new page",
    { slug: z.string(), content: z.string(), folder_id: z.string().optional(), sort_order: z.number().int().optional().describe("Explicit sort position within folder (lower = first). Null/omitted = sort after ordered pages.") },
    async ({ slug, content, folder_id, sort_order }) => {
      validateSlug(slug);
      const existing = await db.page.findUnique({ where: { orgId_slug: { orgId, slug } } });
      if (existing) return { content: [{ type: "text", text: `Error: page already exists: ${slug}` }], isError: true };
      const unsupported = checkUnsupportedComponents(content);
      if (unsupported.length > 0) return { content: [{ type: "text", text: `Error: ${unsupported.map((e) => e.message).join("; ")}` }], isError: true };
      const validationErrors = await validateContent(orgSlug, slug, content);
      if (validationErrors.length > 0) return { content: [{ type: "text", text: `Error: invalid YAML: ${validationErrors.map((e) => e.message).join("; ")}` }], isError: true };
      const result = await writePage(orgId, orgSlug, slug, content, userId || "agent", undefined, sort_order, "org");
      if (!result.ok) return { content: [{ type: "text", text: `Error: ${result.error}` }], isError: true };
      if (folder_id) {
        await db.page.update({ where: { orgId_slug: { orgId, slug } }, data: { folderId: folder_id } });
      }
      logAudit({ orgId, action: "page.create", resourceType: "page", resourceId: slug, actorType: "apikey", actorId, metadata: { slug, folderId: folder_id } });
      return { content: [{ type: "text", text: `Created page "${slug}"` }] };
    });

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
      const page = await db.page.findUnique({ where: { orgId_slug: { orgId, slug } } });
      if (!page) return { content: [{ type: "text", text: `Error: page not found: ${slug}` }], isError: true };
      const targetVersion = await db.pageVersion.findFirst({ where: { id: version_id, pageId: page.id } });
      if (!targetVersion) return { content: [{ type: "text", text: `Error: version not found: ${version_id}` }], isError: true };
      const contentHash = createHash("sha256").update(targetVersion.yamlContent).digest("hex");
      await db.$transaction([
        db.pageVersion.create({
          data: { pageId: page.id, yamlContent: targetVersion.yamlContent, jsonContent: targetVersion.jsonContent ?? undefined, contentHash, createdBy: actorId },
        }),
        db.page.update({ where: { id: page.id }, data: { updatedAt: new Date() } }),
      ]);
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
      }
      await db.page.update({ where: { id: page.id }, data: { folderId } });
      logAudit({ orgId, action: "page.move", resourceType: "page", resourceId: slug, actorType: "apikey", actorId, metadata: { slug, folderId } });
      return { content: [{ type: "text", text: `Moved "${slug}" to ${folderId ? `folder ${folderId}` : "no folder"}` }] };
    });

  server.tool("annotate_page", "Add an annotation to a page",
    { slug: z.string(), text: z.string(), section: z.string().optional(), kind: z.enum(["note", "edit"]).optional(), replacement: z.string().optional() },
    async ({ slug, text, section, kind, replacement }) => {
      validateSlug(slug);
      const annotation = await saveAnnotation(orgId, orgSlug, slug, text, "agent", section, undefined, kind, replacement, "agent");
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

  server.tool("get_component_reference", "Get YAML component authoring guide", {}, async () => {
    const refPath = path.join(process.cwd(), "docs", "agents-reference.md");
    if (!fs.existsSync(refPath)) return { content: [{ type: "text", text: "Component reference not found" }], isError: true };
    return { content: [{ type: "text", text: fs.readFileSync(refPath, "utf-8") }] };
  });

  server.tool("get_vocabulary", "Get all concept terms in the knowledge graph, optionally filtered by kind or search query",
    { kind: z.string().optional(), query: z.string().optional() },
    async ({ kind, query }) => {
      const result = await getVocabulary(kind, query);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    });

  server.tool("get_related", "Get pages and concepts related to a term or page slug",
    { term: z.string().optional(), slug: z.string().optional() },
    async ({ term, slug }) => {
      const result = await getRelated(orgId, { term, slug });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    });

  server.tool("get_semantic_map", "Get full knowledge graph topology — all concepts with their pages and all cross-page links",
    { kind: z.string().optional() },
    async ({ kind }) => {
      const result = await getSemanticMap(kind);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    });

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

  server.tool("create_from_template", "Create a page from a template, interpolating {{variables}}",
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

  return server;
}

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const ctx = await resolveAuth(request);
  if (!ctx) {
    return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "unauthorized — in tailscale auth mode, identity headers only exist on the https:// Tailscale-served URL (plain http:// always 401s); otherwise pass Authorization: Bearer <api key>" }, id: null }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  const server = createMcpServer(ctx.orgId, ctx.orgSlug, ctx.actorId, ctx.userId);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  return transport.handleRequest(request);
}

export async function GET(request: Request) {
  const ctx = await resolveAuth(request);
  if (!ctx) {
    return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "unauthorized — in tailscale auth mode, identity headers only exist on the https:// Tailscale-served URL (plain http:// always 401s); otherwise pass Authorization: Bearer <api key>" }, id: null }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  const server = createMcpServer(ctx.orgId, ctx.orgSlug, ctx.actorId, ctx.userId);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  return transport.handleRequest(request);
}

export async function DELETE(request: Request) {
  return new Response(null, { status: 405 });
}
