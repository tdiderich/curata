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
  "get_versions",
  "validate_page",
];
const WRITE_TOOLS = ["write_page", "create_page", "delete_page", "move_page", "annotate_page", "update_annotation"];
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
    console.error("POST /api/kazam failed:", message);
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
  return NextResponse.json({
    tools: ALL_TOOLS.map((t) => ({
      name: t,
      type: WRITE_TOOLS.includes(t) ? "write" : "read",
    })),
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
    case "list_pages":
      return listPages(orgId);

    case "read_page": {
      if (!args.slug) throw new Error("slug is required");
      if (!SLUG_RE.test(args.slug)) throw new Error("invalid slug format");
      const result = await readPageYaml(orgId, args.slug);
      if (!result) throw new Error(`page not found: ${args.slug}`);
      const sections = await getPageSections(orgId, args.slug);
      const annotations = await getAnnotations(orgId, args.slug);
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

    default:
      throw new Error(`unknown tool: ${tool}`);
  }
}
