import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { addProjectItem, updateProjectItem, removeProjectItem, getProject } from "@/lib/projects";
import { logAudit } from "@/lib/audit";

/**
 * Add, update, or remove one item on a project. Same lib calls as
 * add_project_item / update_project_item / remove_project_item.
 */
export async function POST(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(ctx.role, "page:edit")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body: { term?: string; slug?: string; url?: string; label?: string; owner?: string; dueDate?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.term) return NextResponse.json({ error: "term is required" }, { status: 400 });
  if (!body.slug && !body.url) return NextResponse.json({ error: "slug or url is required" }, { status: 400 });

  try {
    await addProjectItem(ctx.orgId, body.term, {
      slug: body.slug || undefined,
      url: body.url || undefined,
      label: body.label || undefined,
      owner: body.owner || undefined,
      dueDate: body.dueDate || undefined,
    }, ctx.userId);
    logAudit({ orgId: ctx.orgId, action: "project.add_item", resourceType: "project", resourceId: body.term, actorId: ctx.userId, metadata: { slug: body.slug, url: body.url } }).catch(() => {});
    return NextResponse.json(await getProject(ctx.orgId, body.term));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: /no project|not found/.test(message) ? 404 : 400 });
  }
}

export async function PATCH(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(ctx.role, "page:edit")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body: { term?: string; itemId?: string; done?: boolean; owner?: string; dueDate?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.term) return NextResponse.json({ error: "term is required" }, { status: 400 });
  if (!body.itemId) return NextResponse.json({ error: "itemId is required" }, { status: 400 });

  try {
    await updateProjectItem(ctx.orgId, body.term, {
      itemId: body.itemId,
      done: body.done,
      owner: body.owner,
      dueDate: body.dueDate,
    }, ctx.userId);
    logAudit({ orgId: ctx.orgId, action: "project.update_item", resourceType: "project", resourceId: body.term, actorId: ctx.userId, metadata: { itemId: body.itemId, done: body.done } }).catch(() => {});
    return NextResponse.json(await getProject(ctx.orgId, body.term));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: /no project|not found/.test(message) ? 404 : 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(ctx.role, "page:edit")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body: { term?: string; itemId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.term) return NextResponse.json({ error: "term is required" }, { status: 400 });
  if (!body.itemId) return NextResponse.json({ error: "itemId is required" }, { status: 400 });

  await removeProjectItem(ctx.orgId, body.term, body.itemId);
  logAudit({ orgId: ctx.orgId, action: "project.remove_item", resourceType: "project", resourceId: body.term, actorId: ctx.userId, metadata: { itemId: body.itemId } }).catch(() => {});
  return NextResponse.json(await getProject(ctx.orgId, body.term));
}
