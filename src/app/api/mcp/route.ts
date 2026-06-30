import { NextRequest, NextResponse } from "next/server";
import { resolveOrgFromApiKey } from "@/lib/auth";
import { db } from "@/lib/db";
import { dispatch, READ_TOOLS, WRITE_TOOLS, ALL_TOOLS } from "@/lib/mcp-dispatch";

async function resolveAuth(request: NextRequest) {
  if (process.env.CURATA_DEV === "1" && process.env.NODE_ENV === "development") {
    return { orgId: "dev", orgSlug: "dev", scopes: ["read", "write"], userId: "dev" };
  }

  if ((process.env.AUTH_MODE ?? "none") === "none") {
    const org = await db.organization.findFirst({ orderBy: { createdAt: "asc" } });
    if (!org) return null;
    return { orgId: org.id, orgSlug: org.slug, scopes: ["read", "write"], keyPrefix: "noauth", userId: "default" };
  }

  if (process.env.AUTH_MODE === "tailscale") {
    const tsLogin = request.headers.get("tailscale-user-login");
    const devUser = process.env.NODE_ENV === "development" ? process.env.TAILSCALE_DEV_USER : null;
    if (tsLogin || devUser) {
      const { resolveOrg } = await import("@/lib/auth");
      const orgCtx = await resolveOrg();
      if (orgCtx) {
        return { orgId: orgCtx.orgId, orgSlug: orgCtx.orgSlug, scopes: ["read", "write"], keyPrefix: `ts:${tsLogin || devUser}`, userId: orgCtx.userId };
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
    return NextResponse.json({
      error: "unauthorized",
      hint: "In tailscale auth mode, identity headers only exist on the https:// Tailscale-served URL — plain http:// will always 401. Otherwise pass Authorization: Bearer <api key>.",
    }, { status: 401 });
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
    const actorId = ("keyPrefix" in ctx && ctx.keyPrefix) ? ctx.keyPrefix : "dev";
    const result = await dispatch(tool, args || {}, ctx.orgId, ctx.orgSlug ?? "", actorId, ctx.userId);
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
    return NextResponse.json({
      error: "unauthorized",
      hint: "In tailscale auth mode, identity headers only exist on the https:// Tailscale-served URL — plain http:// will always 401. Otherwise pass Authorization: Bearer <api key>.",
    }, { status: 401 });
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
        "Read a workflow page before executing a multi-step task. Use list_workflows to discover available workflows and match user intent to trigger patterns. Use templates when creating new pages — call list_templates to see what's available, then create_from_template to instantiate. Use list_open_annotations to fetch the org-wide queue of human feedback awaiting processing.",
    },
    usage: "POST { tool, args } to invoke a tool",
  });
}
