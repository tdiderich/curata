import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { createProjectFromTemplate, getProject, deleteProject } from "@/lib/projects";
import { logAudit } from "@/lib/audit";

/**
 * Create, read, or delete a project. Same lib calls as the create_project /
 * get_project / delete_project MCP tools, so a human clicking through a
 * future UI and an agent calling over MCP leave identical state.
 */
export async function GET(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const term = request.nextUrl.searchParams.get("term");
  if (!term) return NextResponse.json({ error: "term is required" }, { status: 400 });
  try {
    return NextResponse.json(await getProject(ctx.orgId, term));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: /no project/.test(message) ? 404 : 400 });
  }
}

export async function POST(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(ctx.role, "page:edit")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body: { term?: string; title?: string; templateTerm?: string; source?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.term) return NextResponse.json({ error: "term is required" }, { status: 400 });
  if (!body.title?.trim()) return NextResponse.json({ error: "title is required" }, { status: 400 });

  try {
    const result = await createProjectFromTemplate(ctx.orgId, {
      term: body.term,
      title: body.title,
      templateTerm: body.templateTerm || undefined,
      source: body.source || undefined,
    }, ctx.userId);
    logAudit({
      orgId: ctx.orgId,
      action: "project.create",
      resourceType: "project",
      resourceId: result.term,
      actorId: ctx.userId,
      metadata: { clonedFrom: result.clonedFrom, items: result.items.length, includes: result.includes.length },
    }).catch(() => {});
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(ctx.role, "page:edit")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body: { term?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.term) return NextResponse.json({ error: "term is required" }, { status: 400 });

  await deleteProject(ctx.orgId, body.term);
  logAudit({ orgId: ctx.orgId, action: "project.delete", resourceType: "project", resourceId: body.term, actorId: ctx.userId }).catch(() => {});
  return NextResponse.json({ ok: true, term: body.term });
}
