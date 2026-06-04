import { NextRequest, NextResponse } from "next/server";
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
  getSiteConfig,
} from "@/lib/pages";
import { validateContent, checkUnsupportedComponents } from "@/lib/kazam";
import { ensureComponentIds, applyPatchOperations } from "@/lib/component-ids";
import type { PatchOperation } from "@/lib/component-ids";
import yaml from "js-yaml";
import fs from "fs";
import path from "path";

const READ_TOOLS = [
  "list_pages",
  "read_page",
  "search",
  "get_config",
  "list_annotations",
  "get_component_reference",
  "list_folders",
  "get_folder_structure",
  "get_versions",
  "validate_page",
  "list_workflows",
  "list_templates",
];
const WRITE_TOOLS = ["write_page", "create_page", "delete_page", "move_page", "annotate_page", "update_annotation", "patch_page", "create_folder", "update_folder", "delete_folder", "create_from_template"];
const ALL_TOOLS = [...READ_TOOLS, ...WRITE_TOOLS];

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

async function resolveAuth(request: NextRequest) {
  if (process.env.CURATA_DEV === "1" && process.env.NODE_ENV === "development") {
    return { orgId: "dev", orgSlug: "dev", scopes: ["read", "write"] };
  }

  if ((process.env.AUTH_MODE ?? "none") === "none") {
    const org = await db.organization.findFirst({ orderBy: { createdAt: "asc" } });
    if (!org) return null;
    return { orgId: org.id, orgSlug: org.slug, scopes: ["read", "write"], keyPrefix: "noauth" };
  }

  if (process.env.AUTH_MODE === "tailscale") {
    const tsLogin = request.headers.get("tailscale-user-login");
    const devUser = process.env.NODE_ENV === "development" ? process.env.TAILSCALE_DEV_USER : null;
    if (tsLogin || devUser) {
      const { resolveOrg } = await import("@/lib/auth");
      const orgCtx = await resolveOrg();
      if (orgCtx) {
        return { orgId: orgCtx.orgId, orgSlug: orgCtx.orgSlug, scopes: ["read", "write"], keyPrefix: `ts:${tsLogin || devUser}` };
      }
    }
  }

  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7).trim();
  if (!token) return null;

  return resolveOrgFromApiKey(token);
}

export async function POST(request: NextRequest) {
  const ctx = await resolveAuth(request);
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { tool?: string; args?: Record<string, string> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { tool, args } = body;

  if (!tool || typeof tool !== "string") {
    return NextResponse.json({ error: "missing tool" }, { status: 400 });
  }

  if (!ALL_TOOLS.includes(tool)) {
    return NextResponse.json(
      { error: `unknown tool: ${tool}`, available: ALL_TOOLS },
      { status: 400 }
    );
  }

  if (WRITE_TOOLS.includes(tool) && !ctx.scopes.includes("write")) {
    return NextResponse.json({ error: "insufficient scope" }, { status: 403 });
  }

  try {
    const actorId = "keyPrefix" in ctx ? ctx.keyPrefix : "dev";
    const result = await dispatch(tool, args || {}, ctx.orgId, ctx.orgSlug, actorId);
    return NextResponse.json({ result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("POST /api/mcp failed:", message);
    return NextResponse.json({
      error: message,
      hint: "Call get_component_reference (no args) for the full YAML authoring guide with component syntax and examples.",
    }, { status: 400 });
  }
}

export async function GET(request: NextRequest) {
  const ctx = await resolveAuth(request);
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Build preflight context
  let orgName = ctx.orgSlug;
  let workflowCount = 0;
  let templateCount = 0;
  try {
    const [org, folders] = await Promise.all([
      ctx.orgId !== "dev"
        ? db.organization.findUnique({ where: { id: ctx.orgId }, select: { name: true } })
        : null,
      db.folder.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true } }),
    ]);
    if (org) orgName = org.name;
    const workflowFolder = folders.find((f) => f.name.toLowerCase() === "workflows");
    const templateFolder = folders.find((f) => f.name.toLowerCase() === "templates");
    if (workflowFolder) {
      workflowCount = await db.page.count({ where: { orgId: ctx.orgId, folderId: workflowFolder.id } });
    }
    if (templateFolder) {
      templateCount = await db.page.count({ where: { orgId: ctx.orgId, folderId: templateFolder.id } });
    }
  } catch {
    // preflight is best-effort
  }

  return NextResponse.json({
    tools: ALL_TOOLS.map((t) => ({
      name: t,
      type: WRITE_TOOLS.includes(t) ? "write" : "read",
    })),
    preflight: {
      org: { name: orgName, slug: ctx.orgSlug },
      workflows: workflowCount,
      templates: templateCount,
      instructions:
        "Read a workflow page before executing a multi-step task. Use list_workflows to discover available workflows and match user intent to trigger patterns. Use templates when creating new pages — call list_templates to see what's available, then create_from_template to instantiate.",
    },
    usage: "POST { tool, args } to invoke a tool",
  });
}

async function dispatch(
  tool: string,
  args: Record<string, string>,
  orgId: string,
  orgSlug: string,
  actorId: string
): Promise<unknown> {
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
        db.page.update({ where: { id: page.id }, data: { viewCount: { increment: 1 } } }).catch(() => {});
      }

      return {
        slug: args.slug,
        yaml: result.yaml,
        contentHash: result.contentHash,
        sections,
        annotations,
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
      if (args.parent_id) {
        const parent = await db.folder.findFirst({ where: { id: args.parent_id, orgId } });
        if (!parent) throw new Error(`parent folder not found: ${args.parent_id}`);
      }
      const newFolder = await db.folder.create({
        data: { orgId, name: args.name, visibility: cfVisibility, createdBy: actorId, parentId: args.parent_id ?? null },
      });
      logAudit({ orgId, action: "folder.create", resourceType: "folder", resourceId: newFolder.id, actorType: "apikey", actorId, metadata: { name: args.name, parentId: args.parent_id } });
      return { ok: true, id: newFolder.id, name: newFolder.name };
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

    case "delete_folder": {
      if (!args.id) throw new Error("id is required");
      const dfFolder = await db.folder.findFirst({ where: { id: args.id, orgId } });
      if (!dfFolder) throw new Error(`folder not found: ${args.id}`);
      await db.$transaction([
        db.page.updateMany({ where: { folderId: args.id }, data: { folderId: null } }),
        db.folder.delete({ where: { id: args.id } }),
      ]);
      logAudit({ orgId, action: "folder.delete", resourceType: "folder", resourceId: args.id, actorType: "apikey", actorId, metadata: { name: dfFolder.name } });
      return { ok: true, id: args.id, name: dfFolder.name };
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

    case "delete_page": {
      if (!args.slug) throw new Error("slug is required");
      if (!SLUG_RE.test(args.slug)) throw new Error("invalid slug format");
      const delPage = await db.page.findUnique({
        where: { orgId_slug: { orgId, slug: args.slug } },
      });
      if (!delPage) throw new Error(`page not found: ${args.slug}`);
      await db.page.delete({ where: { id: delPage.id } });
      logAudit({
        orgId,
        action: "page.delete",
        resourceType: "page",
        resourceId: args.slug,
        actorType: "apikey",
        actorId,
        metadata: { slug: args.slug },
      });
      return { ok: true, slug: args.slug };
    }

    case "move_page": {
      if (!args.slug) throw new Error("slug is required");
      if (!SLUG_RE.test(args.slug)) throw new Error("invalid slug format");
      const movePage = await db.page.findUnique({
        where: { orgId_slug: { orgId, slug: args.slug } },
      });
      if (!movePage) throw new Error(`page not found: ${args.slug}`);
      const folderId = args.folder_id || null;
      if (folderId) {
        const folder = await db.folder.findFirst({ where: { id: folderId, orgId } });
        if (!folder) throw new Error(`folder not found: ${folderId}`);
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
        metadata: { slug: args.slug, folderId },
      });
      return { ok: true, slug: args.slug, folderId };
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
          for (const comp of components) {
            if (comp.type === "definition_list" && Array.isArray(comp.items)) {
              const triggerItem = (comp.items as Record<string, unknown>[]).find(
                (item) => typeof item.term === "string" && item.term.toLowerCase() === "trigger"
              );
              if (triggerItem) trigger = String(triggerItem.definition ?? "");
            }
            if (!description && comp.type === "callout" && comp.body) {
              description = String(comp.body);
            }
            if (!description && comp.type === "section") {
              const subComponents = Array.isArray(comp.components) ? comp.components as Record<string, unknown>[] : [];
              const callout = subComponents.find((c) => c.type === "callout" && c.body);
              if (callout) description = String(callout.body);
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

    default:
      throw new Error(`unknown tool: ${tool}`);
  }
}
