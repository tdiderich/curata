// Shared MCP tool dispatch — the single registry of agent-facing tools.
// Consumed by both HTTP transports (src/app/api/mcp/route.ts and
// src/app/api/mcp/stream/route.ts) so the two surfaces can't drift apart.
// tests/mcp-tool-parity.test.ts enforces that every tool listed here is
// registered on the streamable-HTTP server.
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
  getSiteConfig,
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
import yaml from "js-yaml";
import fs from "fs";
import path from "path";

export const READ_TOOLS = [
  "list_pages",
  "read_page",
  "search",
  "get_config",
  "list_annotations",
  "list_open_annotations",
  "list_flags",
  "get_component_reference",
  "list_folders",
  "get_folder_structure",
  "get_versions",
  "validate_page",
  "list_workflows",
  "list_templates",
  "get_vocabulary",
  "get_related",
  "get_semantic_map",
];
export const WRITE_TOOLS = ["write_page", "create_page", "move_page", "annotate_page", "update_annotation", "patch_page", "create_folder", "update_folder", "create_from_template", "flag_page"];
export const ALL_TOOLS = [...READ_TOOLS, ...WRITE_TOOLS];

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

const TOOL_PARAMS: Record<string, { known: Set<string>; aliases?: Record<string, string> }> = {
  list_pages: { known: new Set() },
  read_page: { known: new Set(["slug"]) },
  search: { known: new Set(["query"]) },
  get_config: { known: new Set() },
  list_annotations: { known: new Set(["slug"]) },
  list_open_annotations: { known: new Set(["slug"]) },
  flag_page: { known: new Set(["slug", "action", "reason", "evidence", "superseded_by", "confidence"]), aliases: { supersededBy: "superseded_by" } },
  list_flags: { known: new Set(["status"]) },
  get_component_reference: { known: new Set() },
  list_folders: { known: new Set() },
  get_folder_structure: { known: new Set() },
  create_folder: { known: new Set(["name", "parent_id", "visibility"]), aliases: { parentId: "parent_id" } },
  update_folder: { known: new Set(["id", "name", "parent_id", "visibility"]), aliases: { parentId: "parent_id" } },
  get_versions: { known: new Set(["slug", "limit"]) },
  validate_page: { known: new Set(["slug", "content"]) },
  create_page: { known: new Set(["slug", "content", "folder_id"]), aliases: { folderId: "folder_id" } },
  move_page: { known: new Set(["slug", "folder_id"]), aliases: { folderId: "folder_id" } },
  write_page: { known: new Set(["slug", "content"]) },
  annotate_page: { known: new Set(["slug", "text", "section", "kind", "replacement"]) },
  update_annotation: { known: new Set(["slug", "annotation_id", "status"]), aliases: { annotationId: "annotation_id" } },
  patch_page: { known: new Set(["slug", "operations"]) },
  replace_in_page: { known: new Set(["slug", "target", "replacement"]) },
  create_from_template: { known: new Set(["template_slug", "slug", "variables", "folder_id"]), aliases: { templateSlug: "template_slug", folderId: "folder_id" } },
  list_workflows: { known: new Set() },
  list_templates: { known: new Set() },
  get_vocabulary: { known: new Set() },
  get_related: { known: new Set(["slug"]) },
  get_semantic_map: { known: new Set(["kind"]) },
};

function validateParams(tool: string, args: Record<string, string>): Record<string, string> {
  const spec = TOOL_PARAMS[tool];
  if (!spec) return args;
  const corrected = { ...args };
  if (spec.aliases) {
    for (const [alias, canonical] of Object.entries(spec.aliases)) {
      if (alias in corrected && !(canonical in corrected)) {
        corrected[canonical] = corrected[alias];
        delete corrected[alias];
      }
    }
  }
  const unknown = Object.keys(corrected).filter((k) => !spec.known.has(k));
  if (unknown.length > 0) {
    const suggestions = unknown.map((k) => {
      const close = [...spec.known].find((p) => p.replace(/_/g, "") === k.replace(/[_-]/g, "").toLowerCase());
      return close ? `"${k}" (did you mean "${close}"?)` : `"${k}"`;
    });
    throw new Error(`unknown parameter${unknown.length > 1 ? "s" : ""} for ${tool}: ${suggestions.join(", ")}. Valid: ${[...spec.known].join(", ")}`);
  }
  return corrected;
}

export async function dispatch(
  tool: string,
  args: Record<string, string>,
  orgId: string,
  orgSlug: string,
  actorId: string
): Promise<unknown> {
  args = validateParams(tool, args);
  switch (tool) {
    case "list_pages": {
      const [pages, folders] = await Promise.all([
        listPages(orgId),
        db.folder.findMany({ where: { orgId }, select: { id: true, name: true } }),
      ]);
      const folderMap = new Map(folders.map((f) => [f.id, f.name]));
      return pages.map((p) => ({ ...p, folderName: p.folderId ? folderMap.get(p.folderId) ?? null : null }));
    }

    case "read_page": {
      if (!args.slug) throw new Error("slug is required");
      if (!SLUG_RE.test(args.slug)) throw new Error("invalid slug format");
      const result = await readPageYaml(orgId, args.slug);
      if (!result) throw new Error(`page not found: ${args.slug}`);

      const parsed = yaml.load(result.yaml) as Record<string, unknown>;
      if (Array.isArray(parsed.components)) {
        parsed.components = ensureComponentIds(parsed.components as Record<string, unknown>[]);
        result.yaml = yaml.dump(parsed, { lineWidth: -1, noRefs: true });
      }

      const sections = await getPageSections(orgId, args.slug);
      const annotations = await getAnnotations(orgId, args.slug);

      const page = await db.page.findUnique({
        where: { orgId_slug: { orgId, slug: args.slug } },
        select: { id: true },
      });
      if (page) {
        bumpViewCount(page.id).catch(() => {});
      }

      const concepts = page ? await getPageConcepts(page.id) : [];
      const links = page ? await getPageLinks(orgId, page.id) : [];

      return {
        slug: args.slug,
        yaml: result.yaml,
        contentHash: result.contentHash,
        sections,
        annotations,
        concepts,
        links,
      };
    }

    case "search": {
      if (!args.query) throw new Error("query is required");
      return searchPages(orgId, args.query);
    }

    case "get_config":
      return getSiteConfig(orgId);

    case "list_annotations": {
      if (!args.slug) throw new Error("slug is required");
      if (!SLUG_RE.test(args.slug)) throw new Error("invalid slug format");
      return getAnnotations(orgId, args.slug);
    }

    case "list_open_annotations": {
      // Org-wide review queue: every annotation a human hasn't dispositioned
      // yet, grouped by page. This is the entry point for the
      // process-annotations workflow.
      const statusArg = args.status;
      const statusWhere =
        statusArg === "pending" || statusArg === "approved"
          ? statusArg
          : { in: ["pending", "approved"] };
      const openAnns = await db.annotation.findMany({
        where: { status: statusWhere, page: { orgId } },
        orderBy: { createdAt: "asc" },
        include: { page: { select: { slug: true, title: true } } },
      });
      const grouped = new Map<
        string,
        { slug: string; title: string; annotations: Array<Record<string, unknown>> }
      >();
      for (const a of openAnns) {
        const entry = grouped.get(a.page.slug) ?? {
          slug: a.page.slug,
          title: a.page.title,
          annotations: [],
        };
        entry.annotations.push({
          id: a.id,
          text: a.text,
          author: a.author,
          section: a.section,
          target: a.target,
          kind: a.kind,
          replacement: a.replacement,
          status: a.status,
          source: a.source,
          createdAt: a.createdAt,
        });
        grouped.set(a.page.slug, entry);
      }
      return {
        totalAnnotations: openAnns.length,
        pageCount: grouped.size,
        pages: [...grouped.values()],
        instructions:
          "For each page: read_page to get content + contentHash, apply 'edit'-kind annotations (replace target with replacement) and judge 'note'-kind feedback, write the page back, then update_annotation with status 'incorporated' (or 'ignored' with a reason annotation). See the 'Workflow — Process Annotations' page for the full procedure.",
      };
    }

    case "flag_page": {
      // Agent proposes, human disposes: flags queue a cleanup decision with
      // evidence; nothing is archived or deleted until a human acts on the
      // Cleanup view.
      if (!args.slug) throw new Error("slug is required");
      if (!SLUG_RE.test(args.slug)) throw new Error("invalid slug format");
      const FLAG_ACTIONS = ["archive", "delete", "merge", "supersede"];
      const FLAG_REASONS = ["shipped-not-closed", "superseded", "stale", "duplicate", "one-off-expired"];
      const FLAG_CONFIDENCE = ["high", "medium", "low"];
      if (!args.action || !FLAG_ACTIONS.includes(args.action)) {
        throw new Error(`action must be one of: ${FLAG_ACTIONS.join(", ")}`);
      }
      if (!args.reason || !FLAG_REASONS.includes(args.reason)) {
        throw new Error(`reason must be one of: ${FLAG_REASONS.join(", ")}`);
      }
      if (!args.evidence) throw new Error("evidence is required — cite what you checked (repo paths, dates, task state)");
      if (args.confidence && !FLAG_CONFIDENCE.includes(args.confidence)) {
        throw new Error("confidence must be high, medium, or low");
      }
      if (args.action === "supersede" && !args.superseded_by) {
        throw new Error("superseded_by (slug of the replacing page) is required when action is supersede");
      }
      if (args.superseded_by && !SLUG_RE.test(args.superseded_by)) {
        throw new Error("invalid superseded_by slug format");
      }
      const flagPage = await db.page.findUnique({
        where: { orgId_slug: { orgId, slug: args.slug } },
        select: { id: true, status: true },
      });
      if (!flagPage) throw new Error(`page not found: ${args.slug}`);
      if (flagPage.status === "archived") throw new Error(`page is already archived: ${args.slug}`);
      // A kept (dismissed) flag is a human decision — don't re-file the same
      // proposal on a later sweep.
      const dismissed = await db.pageFlag.findFirst({
        where: { pageId: flagPage.id, status: "kept", reason: args.reason },
        orderBy: { resolvedAt: "desc" },
      });
      if (dismissed) {
        return {
          ok: false,
          skipped: true,
          message: `A ${args.reason} flag on this page was dismissed by a human on ${dismissed.resolvedAt?.toISOString().slice(0, 10)} — not re-filing. Use a different reason with new evidence if circumstances changed.`,
        };
      }
      const existingFlag = await db.pageFlag.findFirst({
        where: { pageId: flagPage.id, status: "pending" },
      });
      const flag = await db.pageFlag.create({
        data: {
          pageId: flagPage.id,
          action: args.action,
          reason: args.reason,
          evidence: args.evidence,
          supersededBy: args.superseded_by ?? null,
          confidence: args.confidence ?? "medium",
          actorId,
        },
      });
      await db.$executeRaw`UPDATE pages SET status = 'flagged' WHERE id = ${flagPage.id} AND status = 'active'`;
      logAudit({ orgId, action: "page.flag", resourceType: "page", resourceId: args.slug, actorType: "apikey", actorId, metadata: { action: args.action, reason: args.reason, confidence: args.confidence } });
      return { ok: true, flagId: flag.id, note: existingFlag ? "page already had a pending flag — both are queued, latest wins for display" : undefined };
    }

    case "list_flags": {
      // Default: everything a future sweep needs to avoid duplicate work —
      // pending flags plus human dispositions (kept/snoozed).
      const flagStatus = args.status; // pending | kept | snoozed | resolved | all
      const flagWhere: Record<string, unknown> = { page: { orgId } };
      if (flagStatus && flagStatus !== "all") flagWhere.status = flagStatus;
      const flags = await db.pageFlag.findMany({
        where: flagWhere,
        orderBy: { createdAt: "desc" },
        include: { page: { select: { slug: true, title: true, status: true } } },
      });
      return flags.map((f) => ({
        id: f.id,
        slug: f.page.slug,
        title: f.page.title,
        pageStatus: f.page.status,
        action: f.action,
        reason: f.reason,
        evidence: f.evidence,
        supersededBy: f.supersededBy,
        confidence: f.confidence,
        flaggedBy: f.actorId,
        flaggedAt: f.createdAt,
        status: f.status,
        snoozeUntil: f.snoozeUntil,
        resolvedBy: f.resolvedBy,
        resolvedAt: f.resolvedAt,
      }));
    }

    case "get_component_reference": {
      const refPath = path.join(process.cwd(), "docs", "agents-reference.md");
      if (!fs.existsSync(refPath)) {
        return {
          error: "component reference not found — run the setup script",
        };
      }
      return { content: fs.readFileSync(refPath, "utf-8") };
    }

    case "list_folders": {
      const folders = await db.folder.findMany({
        where: { orgId },
        orderBy: { name: "asc" },
        include: { _count: { select: { pages: true } } },
      });
      return folders.map((f) => ({
        id: f.id,
        name: f.name,
        parentId: f.parentId,
        visibility: f.visibility,
        pageCount: f._count.pages,
      }));
    }

    case "get_folder_structure": {
      const [gfsFolders, gfsPages] = await Promise.all([
        db.folder.findMany({ where: { orgId }, orderBy: { name: "asc" }, include: { _count: { select: { pages: true } } } }),
        listPages(orgId),
      ]);
      return {
        folders: gfsFolders.map((f) => ({ id: f.id, name: f.name, parentId: f.parentId, pageCount: f._count.pages })),
        pages: gfsPages.map((p) => ({ slug: p.slug, title: p.title, folderId: p.folderId })),
      };
    }

    case "create_folder": {
      if (!args.name) throw new Error("name is required");
      const cfVisibility = args.visibility ?? "shared";
      if (cfVisibility !== "personal" && cfVisibility !== "shared") {
        throw new Error("visibility must be 'personal' or 'shared'");
      }
      let parentName: string | null = null;
      if (args.parent_id) {
        const parent = await db.folder.findFirst({ where: { id: args.parent_id, orgId } });
        if (!parent) throw new Error(`parent folder not found: ${args.parent_id}`);
        parentName = parent.name;
      }
      const existingFolder = await db.folder.findFirst({ where: { orgId, name: args.name, parentId: args.parent_id ?? null } });
      if (existingFolder) throw new Error(`folder "${args.name}" already exists${parentName ? ` under "${parentName}"` : " at root"}`);
      const newFolder = await db.folder.create({
        data: { orgId, name: args.name, visibility: cfVisibility, createdBy: actorId, parentId: args.parent_id ?? null },
      });
      logAudit({ orgId, action: "folder.create", resourceType: "folder", resourceId: newFolder.id, actorType: "apikey", actorId, metadata: { name: args.name, parentId: args.parent_id, parentName } });
      return { ok: true, id: newFolder.id, name: newFolder.name, parentId: args.parent_id ?? null, parentName, visibility: cfVisibility };
    }

    case "update_folder": {
      if (!args.id) throw new Error("id is required");
      const ufFolder = await db.folder.findFirst({ where: { id: args.id, orgId } });
      if (!ufFolder) throw new Error(`folder not found: ${args.id}`);
      if (args.parent_id) {
        const parent = await db.folder.findFirst({ where: { id: args.parent_id, orgId } });
        if (!parent) throw new Error(`parent folder not found: ${args.parent_id}`);
      }
      if (args.visibility && args.visibility !== "personal" && args.visibility !== "shared") {
        throw new Error("visibility must be 'personal' or 'shared'");
      }
      const ufData: Record<string, unknown> = {};
      if (args.name !== undefined) ufData.name = args.name;
      if (args.parent_id !== undefined) ufData.parentId = args.parent_id || null;
      if (args.visibility !== undefined) ufData.visibility = args.visibility;
      await db.folder.update({ where: { id: args.id }, data: ufData });
      logAudit({ orgId, action: "folder.update", resourceType: "folder", resourceId: args.id, actorType: "apikey", actorId, metadata: { name: args.name, parentId: args.parent_id, visibility: args.visibility } });
      return { ok: true, id: args.id };
    }

    case "get_versions": {
      if (!args.slug) throw new Error("slug is required");
      if (!SLUG_RE.test(args.slug)) throw new Error("invalid slug format");
      const page = await db.page.findUnique({
        where: { orgId_slug: { orgId, slug: args.slug } },
        include: {
          versions: {
            orderBy: { createdAt: "desc" },
            take: Math.min(Math.max(parseInt(args.limit || "10", 10) || 10, 1), 50),
            select: { id: true, contentHash: true, createdBy: true, createdAt: true },
          },
        },
      });
      if (!page) throw new Error(`page not found: ${args.slug}`);
      return page.versions;
    }

    case "validate_page": {
      if (!args.slug) throw new Error("slug is required");
      if (!SLUG_RE.test(args.slug)) throw new Error("invalid slug format");
      if (!args.content) throw new Error("content (YAML) is required");
      const validateUnsupported = checkUnsupportedComponents(args.content);
      const errors = [...validateUnsupported, ...await validateContent(orgSlug, args.slug, args.content)];
      return { valid: errors.length === 0, errors: errors.map((e) => e.message) };
    }

    case "create_page": {
      if (!args.slug) throw new Error("slug is required");
      if (!SLUG_RE.test(args.slug)) throw new Error("invalid slug format");
      if (!args.content) throw new Error("content (YAML) is required");
      const unsupported = checkUnsupportedComponents(args.content);
      if (unsupported.length > 0) {
        throw new Error(unsupported.map((e) => e.message).join("; "));
      }
      const existing = await db.page.findUnique({
        where: { orgId_slug: { orgId, slug: args.slug } },
      });
      if (existing) throw new Error(`page already exists: ${args.slug}`);
      const createValidation = await validateContent(orgSlug, args.slug, args.content);
      if (createValidation.length > 0) {
        const messages = createValidation.map((e) => e.message).join("; ");
        throw new Error(`invalid YAML: ${messages}`);
      }
      const createResult = await writePage(orgId, orgSlug, args.slug, args.content, "agent");
      if (!createResult.ok) throw new Error(createResult.error);
      if (args.folder_id) {
        const cpFolder = await db.folder.findFirst({ where: { id: args.folder_id, orgId } });
        if (!cpFolder) throw new Error(`folder not found: ${args.folder_id}`);
        await db.page.update({
          where: { orgId_slug: { orgId, slug: args.slug } },
          data: { folderId: args.folder_id },
        });
      }
      logAudit({
        orgId,
        action: "page.create",
        resourceType: "page",
        resourceId: args.slug,
        actorType: "apikey",
        actorId,
        metadata: { slug: args.slug, folderId: args.folder_id },
      });
      return createResult;
    }

    case "move_page": {
      if (!args.slug) throw new Error("slug is required");
      if (!SLUG_RE.test(args.slug)) throw new Error("invalid slug format");
      const movePage = await db.page.findUnique({
        where: { orgId_slug: { orgId, slug: args.slug } },
        include: { folder: { select: { name: true } } },
      });
      if (!movePage) throw new Error(`page not found: ${args.slug}`);
      const folderId = args.folder_id || null;
      let targetFolderName: string | null = null;
      if (folderId) {
        const folder = await db.folder.findFirst({ where: { id: folderId, orgId } });
        if (!folder) throw new Error(`folder not found: ${folderId}`);
        targetFolderName = folder.name;
      }
      const previousFolderId = movePage.folderId;
      const previousFolderName = (movePage as unknown as { folder: { name: string } | null }).folder?.name ?? null;
      if (previousFolderId === folderId) {
        return { ok: true, slug: args.slug, folderId, folderName: targetFolderName, note: "page was already in this folder — no change" };
      }
      await db.page.update({
        where: { id: movePage.id },
        data: { folderId },
      });
      logAudit({
        orgId,
        action: "page.move",
        resourceType: "page",
        resourceId: args.slug,
        actorType: "apikey",
        actorId,
        metadata: { slug: args.slug, folderId, folderName: targetFolderName, previousFolderId, previousFolderName },
      });
      return { ok: true, slug: args.slug, folderId, folderName: targetFolderName, previousFolderId, previousFolderName };
    }

    case "write_page": {
      if (!args.slug) throw new Error("slug is required");
      if (!SLUG_RE.test(args.slug)) throw new Error("invalid slug format");
      if (!args.content) throw new Error("content (YAML) is required");
      const writeUnsupported = checkUnsupportedComponents(args.content);
      if (writeUnsupported.length > 0) {
        throw new Error(writeUnsupported.map((e) => e.message).join("; "));
      }
      const validationErrors = await validateContent(orgSlug, args.slug, args.content);
      if (validationErrors.length > 0) {
        const messages = validationErrors.map((e) => e.message).join("; ");
        throw new Error(`invalid YAML: ${messages}`);
      }
      const writeResult = await writePage(
        orgId,
        orgSlug,
        args.slug,
        args.content,
        "agent",
        args.expected_hash
      );
      if (!writeResult.ok) {
        throw new Error(writeResult.error);
      }
      if (args.visibility) {
        const validVis = ["personal", "shared", "public"];
        if (!validVis.includes(args.visibility)) throw new Error(`invalid visibility: ${args.visibility}`);
        await db.page.update({
          where: { orgId_slug: { orgId, slug: args.slug } },
          data: { visibility: args.visibility },
        });
      }
      if (args.folder_id) {
        const folder = await db.folder.findFirst({ where: { id: args.folder_id, orgId } });
        if (!folder) throw new Error(`folder not found: ${args.folder_id}`);
        await db.page.update({
          where: { orgId_slug: { orgId, slug: args.slug } },
          data: { folderId: args.folder_id },
        });
      }
      if (args.concepts || args.links) {
        const wpPage = await db.page.findUnique({
          where: { orgId_slug: { orgId, slug: args.slug } },
          select: { id: true },
        });
        if (wpPage) {
          if (args.concepts) {
            const conceptInputs: ConceptInput[] = JSON.parse(args.concepts);
            await upsertConcepts(wpPage.id, conceptInputs, actorId);
          }
          if (args.links) {
            const linkInputs: LinkInput[] = JSON.parse(args.links);
            await upsertLinks(orgId, wpPage.id, linkInputs, actorId);
          }
        }
      }
      logAudit({
        orgId,
        action: "page.write",
        resourceType: "page",
        resourceId: args.slug,
        actorType: "apikey",
        actorId,
        metadata: { slug: args.slug },
      });
      return writeResult;
    }

    case "annotate_page": {
      if (!args.slug) throw new Error("slug is required");
      if (!SLUG_RE.test(args.slug)) throw new Error("invalid slug format");
      if (!args.text) throw new Error("text is required");
      const annotation = await saveAnnotation(
        orgId,
        orgSlug,
        args.slug,
        args.text,
        args.author || "agent",
        args.section,
        args.target,
        (args.kind as "note" | "edit") || undefined,
        args.replacement,
        "agent"
      );
      logAudit({
        orgId,
        action: "annotation.create",
        resourceType: "annotation",
        resourceId: (annotation as { id?: string }).id ?? args.slug,
        actorType: "apikey",
        actorId,
        metadata: { slug: args.slug, section: args.section, kind: args.kind },
      });
      return annotation;
    }

    case "update_annotation": {
      if (!args.slug) throw new Error("slug is required");
      if (!SLUG_RE.test(args.slug)) throw new Error("invalid slug format");
      if (!args.id) throw new Error("id is required");
      if (!args.status) throw new Error("status is required");
      if (
        args.status !== "approved" &&
        args.status !== "incorporated" &&
        args.status !== "ignored"
      ) {
        throw new Error(
          "status must be 'approved', 'incorporated', or 'ignored'"
        );
      }
      const updated = await updateAnnotationStatus(
        orgId,
        orgSlug,
        args.slug,
        args.id,
        args.status
      );
      if (!updated) throw new Error("annotation not found");
      logAudit({
        orgId,
        action: "annotation.update",
        resourceType: "annotation",
        resourceId: args.id,
        actorType: "apikey",
        actorId,
        metadata: { slug: args.slug, status: args.status },
      });
      return { ok: true };
    }

    case "patch_page": {
      if (!args.slug) throw new Error("slug is required");
      if (!SLUG_RE.test(args.slug)) throw new Error("invalid slug format");
      if (!args.expected_hash) throw new Error("expected_hash is required");
      if (!args.operations) throw new Error("operations (JSON array) is required");

      let operations: PatchOperation[];
      try {
        operations = JSON.parse(args.operations);
      } catch {
        throw new Error("operations must be valid JSON");
      }
      if (!Array.isArray(operations)) throw new Error("operations must be an array");

      const current = await readPageYaml(orgId, args.slug);
      if (!current) throw new Error(`page not found: ${args.slug}`);

      if (current.contentHash !== args.expected_hash) {
        throw new Error(`conflict: page was modified since last read (current hash: ${current.contentHash})`);
      }

      const parsed = yaml.load(current.yaml) as Record<string, unknown>;
      if (!Array.isArray(parsed.components)) {
        throw new Error("page has no components array — use write_page instead");
      }

      parsed.components = ensureComponentIds(parsed.components as Record<string, unknown>[]);
      const patched = applyPatchOperations(parsed as { components: Record<string, unknown>[]; [k: string]: unknown }, operations);
      patched.components = ensureComponentIds(patched.components);

      const newYaml = yaml.dump(patched, { lineWidth: -1, noRefs: true });

      const patchUnsupported = checkUnsupportedComponents(newYaml);
      if (patchUnsupported.length > 0) {
        throw new Error(patchUnsupported.map((e) => e.message).join("; "));
      }
      const patchValidation = await validateContent(orgSlug, args.slug, newYaml);
      if (patchValidation.length > 0) {
        throw new Error(`invalid after patch: ${patchValidation.map((e) => e.message).join("; ")}`);
      }

      const patchResult = await writePage(orgId, orgSlug, args.slug, newYaml, "agent", current.contentHash);
      if (!patchResult.ok) throw new Error(patchResult.error);

      if (args.concepts || args.links) {
        const ppPage = await db.page.findUnique({
          where: { orgId_slug: { orgId, slug: args.slug } },
          select: { id: true },
        });
        if (ppPage) {
          if (args.concepts) {
            const conceptInputs: ConceptInput[] = JSON.parse(args.concepts);
            await upsertConcepts(ppPage.id, conceptInputs, actorId);
          }
          if (args.links) {
            const linkInputs: LinkInput[] = JSON.parse(args.links);
            await upsertLinks(orgId, ppPage.id, linkInputs, actorId);
          }
        }
      }
      logAudit({
        orgId,
        action: "page.patch",
        resourceType: "page",
        resourceId: args.slug,
        actorType: "apikey",
        actorId,
        metadata: { slug: args.slug, operationCount: operations.length },
      });
      return patchResult;
    }

    case "list_workflows": {
      const lwFolders = await db.folder.findMany({ where: { orgId }, select: { id: true, name: true } });
      const lwFolder = lwFolders.find((f) => f.name.toLowerCase() === "workflows");
      if (!lwFolder) return [];
      const lwPages = await db.page.findMany({
        where: { orgId, folderId: lwFolder.id },
        include: { versions: { orderBy: { createdAt: "desc" }, take: 1, select: { yamlContent: true } } },
      });
      return lwPages.map((p) => {
        let trigger: string | null = null;
        let description: string | null = null;
        try {
          const raw = p.versions[0]?.yamlContent ?? "";
          const parsed = yaml.load(raw) as Record<string, unknown>;
          const components = Array.isArray(parsed?.components) ? parsed.components as Record<string, unknown>[] : [];
          // Triggers and descriptions usually live one level down, inside a
          // section's components — scan both depths.
          const flat: Record<string, unknown>[] = [];
          for (const comp of components) {
            flat.push(comp);
            if (comp.type === "section" && Array.isArray(comp.components)) {
              flat.push(...(comp.components as Record<string, unknown>[]));
            }
          }
          for (const comp of flat) {
            if (!trigger && comp.type === "definition_list" && Array.isArray(comp.items)) {
              const triggerItem = (comp.items as Record<string, unknown>[]).find(
                (item) => typeof item.term === "string" && item.term.toLowerCase() === "trigger"
              );
              if (triggerItem) trigger = String(triggerItem.definition ?? "");
            }
            if (!description && comp.type === "callout" && comp.body) {
              description = String(comp.body);
            }
          }
        } catch {
          // best-effort extraction
        }
        return { slug: p.slug, title: p.title, trigger, description };
      });
    }

    case "list_templates": {
      const ltFolders = await db.folder.findMany({ where: { orgId }, select: { id: true, name: true } });
      const ltFolder = ltFolders.find((f) => f.name.toLowerCase() === "templates");
      if (!ltFolder) return [];
      const ltPages = await db.page.findMany({
        where: { orgId, folderId: ltFolder.id },
        include: { versions: { orderBy: { createdAt: "desc" }, take: 1, select: { yamlContent: true } } },
      });
      return ltPages.map((p) => {
        const raw = p.versions[0]?.yamlContent ?? "";
        const variables: string[] = [];
        const seen = new Set<string>();
        for (const match of raw.matchAll(/\{\{(\w+)\}\}/g)) {
          if (!seen.has(match[1])) {
            seen.add(match[1]);
            variables.push(match[1]);
          }
        }
        return { slug: p.slug, title: p.title, variables };
      });
    }

    case "create_from_template": {
      if (!args.template_slug) throw new Error("template_slug is required");
      if (!SLUG_RE.test(args.template_slug)) throw new Error("invalid template_slug format");
      if (!args.target_slug) throw new Error("target_slug is required");
      if (!SLUG_RE.test(args.target_slug)) throw new Error("invalid target_slug format");

      const tmplResult = await readPageYaml(orgId, args.template_slug);
      if (!tmplResult) throw new Error(`template not found: ${args.template_slug}`);

      let variables: Record<string, string> = {};
      if (args.variables) {
        try {
          variables = JSON.parse(args.variables);
        } catch {
          throw new Error("variables must be valid JSON");
        }
      }

      const interpolated = tmplResult.yaml.replace(/\{\{(\w+)\}\}/g, (_, key: string) => variables[key] ?? `{{${key}}}`);

      const cftUnsupported = checkUnsupportedComponents(interpolated);
      if (cftUnsupported.length > 0) {
        throw new Error(cftUnsupported.map((e) => e.message).join("; "));
      }
      const cftValidation = await validateContent(orgSlug, args.target_slug, interpolated);
      if (cftValidation.length > 0) {
        throw new Error(`invalid after interpolation: ${cftValidation.map((e) => e.message).join("; ")}`);
      }

      const existing = await db.page.findUnique({ where: { orgId_slug: { orgId, slug: args.target_slug } } });
      if (existing) throw new Error(`page already exists: ${args.target_slug}`);

      const cftResult = await writePage(orgId, orgSlug, args.target_slug, interpolated, "agent");
      if (!cftResult.ok) throw new Error(cftResult.error);

      if (args.folder_id) {
        const folder = await db.folder.findFirst({ where: { id: args.folder_id, orgId } });
        if (!folder) throw new Error(`folder not found: ${args.folder_id}`);
        await db.page.update({
          where: { orgId_slug: { orgId, slug: args.target_slug } },
          data: { folderId: args.folder_id },
        });
      }

      logAudit({
        orgId,
        action: "page.create",
        resourceType: "page",
        resourceId: args.target_slug,
        actorType: "apikey",
        actorId,
        metadata: { slug: args.target_slug, templateSlug: args.template_slug, folderId: args.folder_id },
      });
      return { ...cftResult, slug: args.target_slug };
    }

    case "get_vocabulary": {
      return getVocabulary(args.kind || undefined, args.query || undefined);
    }

    case "get_related": {
      return getRelated(orgId, {
        term: args.term || undefined,
        slug: args.slug || undefined,
      });
    }

    case "get_semantic_map": {
      return getSemanticMap(args.kind || undefined);
    }

    default:
      throw new Error(`unknown tool: ${tool}`);
  }
}
