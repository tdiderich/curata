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
} from "@/lib/pages";
import { validateContent, checkUnsupportedComponents } from "@/lib/kazam";
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
    return { orgId: org.id, orgSlug: org.slug, actorId: "noauth" };
  }

  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;
  const result = await resolveOrgFromApiKey(token);
  if (!result) return null;
  return { orgId: result.orgId, orgSlug: result.orgSlug, actorId: result.keyPrefix || "apikey" };
}

function createMcpServer(orgId: string, orgSlug: string, actorId: string): McpServer {
  const server = new McpServer({ name: "curata", version: "0.1.0" });

  server.tool("search_pages", "Search the knowledge base", { query: z.string() }, async ({ query }) => {
    const results = await searchPages(orgId, query);
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  });

  server.tool("list_pages", "List all pages", {}, async () => {
    const [pages, folders] = await Promise.all([
      listPages(orgId),
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
    const sections = await getPageSections(orgId, slug);
    const annotations = await getAnnotations(orgId, slug);
    return { content: [{ type: "text", text: JSON.stringify({ slug, yaml: result.yaml, contentHash: result.contentHash, sections, annotations }, null, 2) }] };
  });

  server.tool("write_page", "Create or update a page",
    { slug: z.string(), content: z.string(), folder_id: z.string().optional() },
    async ({ slug, content, folder_id }) => {
      validateSlug(slug);
      const unsupported = checkUnsupportedComponents(content);
      if (unsupported.length > 0) return { content: [{ type: "text", text: `Error: ${unsupported.map((e) => e.message).join("; ")}` }], isError: true };
      const validationErrors = await validateContent(orgSlug, slug, content);
      if (validationErrors.length > 0) return { content: [{ type: "text", text: `Error: invalid YAML: ${validationErrors.map((e) => e.message).join("; ")}` }], isError: true };
      const result = await writePage(orgId, orgSlug, slug, content, "agent");
      if (!result.ok) return { content: [{ type: "text", text: `Error: ${result.error}` }], isError: true };
      if (folder_id) {
        await db.page.update({ where: { orgId_slug: { orgId, slug } }, data: { folderId: folder_id } });
      }
      logAudit({ orgId, action: "page.write", resourceType: "page", resourceId: slug, actorType: "apikey", actorId, metadata: { slug } });
      return { content: [{ type: "text", text: `Updated page "${slug}"` }] };
    });

  server.tool("create_page", "Create a new page",
    { slug: z.string(), content: z.string(), folder_id: z.string().optional() },
    async ({ slug, content, folder_id }) => {
      validateSlug(slug);
      const existing = await db.page.findUnique({ where: { orgId_slug: { orgId, slug } } });
      if (existing) return { content: [{ type: "text", text: `Error: page already exists: ${slug}` }], isError: true };
      const unsupported = checkUnsupportedComponents(content);
      if (unsupported.length > 0) return { content: [{ type: "text", text: `Error: ${unsupported.map((e) => e.message).join("; ")}` }], isError: true };
      const validationErrors = await validateContent(orgSlug, slug, content);
      if (validationErrors.length > 0) return { content: [{ type: "text", text: `Error: invalid YAML: ${validationErrors.map((e) => e.message).join("; ")}` }], isError: true };
      const result = await writePage(orgId, orgSlug, slug, content, "agent");
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

  return server;
}

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const ctx = await resolveAuth(request);
  if (!ctx) {
    return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "unauthorized" }, id: null }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  const server = createMcpServer(ctx.orgId, ctx.orgSlug, ctx.actorId);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  return transport.handleRequest(request);
}

export async function GET(request: Request) {
  const ctx = await resolveAuth(request);
  if (!ctx) {
    return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "unauthorized" }, id: null }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  const server = createMcpServer(ctx.orgId, ctx.orgSlug, ctx.actorId);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  return transport.handleRequest(request);
}

export async function DELETE(request: Request) {
  return new Response(null, { status: 405 });
}
