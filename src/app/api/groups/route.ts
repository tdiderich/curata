import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { createGroup, renameGroup, deleteGroup, listGroupsWithMembers } from "@/lib/groups";

export async function GET() {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const groups = await listGroupsWithMembers(ctx.orgId);
    return NextResponse.json(groups);
  } catch (err) {
    console.error("groups error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!can(ctx.role, "group:manage")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const body = (await request.json()) as { name?: string };
    if (!body.name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const group = await createGroup(ctx.orgId, body.name);
    logAudit({
      orgId: ctx.orgId,
      action: "group.create",
      resourceType: "group",
      resourceId: group.id,
      actorType: "user",
      actorId: ctx.userId,
      metadata: { name: group.name },
    });
    return NextResponse.json(group, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "internal error";
    if (message.startsWith("a group named")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    if (message === "name is required" || message.endsWith("characters or fewer")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error("groups error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!can(ctx.role, "group:manage")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const body = (await request.json()) as { groupId?: string; name?: string };
    if (!body.groupId || !body.name) {
      return NextResponse.json({ error: "groupId and name are required" }, { status: 400 });
    }

    const group = await renameGroup(ctx.orgId, body.groupId, body.name);
    logAudit({
      orgId: ctx.orgId,
      action: "group.rename",
      resourceType: "group",
      resourceId: group.id,
      actorType: "user",
      actorId: ctx.userId,
      metadata: { name: group.name },
    });
    return NextResponse.json(group);
  } catch (err) {
    const message = err instanceof Error ? err.message : "internal error";
    if (message.startsWith("group not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message.startsWith("a group named")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!can(ctx.role, "group:manage")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const body = (await request.json()) as { groupId?: string };
    if (!body.groupId) {
      return NextResponse.json({ error: "groupId is required" }, { status: 400 });
    }

    await deleteGroup(ctx.orgId, body.groupId);
    logAudit({
      orgId: ctx.orgId,
      action: "group.delete",
      resourceType: "group",
      resourceId: body.groupId,
      actorType: "user",
      actorId: ctx.userId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "internal error";
    if (message.startsWith("group not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    console.error("groups error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
