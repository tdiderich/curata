import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { addGroupMembers, removeGroupMember, setGroupMemberRole } from "@/lib/groups";

// Membership ops for groups: POST is the bulk-add endpoint (one or many
// userIds in a single call), PATCH transfers a member's role, DELETE removes
// a single member. All gated to group:manage (org owner/admin) — the same
// capability that gates the group CRUD route.

export async function POST(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!can(ctx.role, "group:manage")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const body = (await request.json()) as { groupId?: string; userIds?: string[]; role?: string };
    if (!body.groupId) {
      return NextResponse.json({ error: "groupId is required" }, { status: 400 });
    }
    if (!Array.isArray(body.userIds) || body.userIds.length === 0) {
      return NextResponse.json({ error: "userIds must be a non-empty array" }, { status: 400 });
    }

    const role = body.role === "owner" ? "owner" : "member";
    const result = await addGroupMembers(ctx.orgId, body.groupId, body.userIds, role);
    logAudit({
      orgId: ctx.orgId,
      action: "group.member.add",
      resourceType: "group",
      resourceId: body.groupId,
      actorType: "user",
      actorId: ctx.userId,
      metadata: { added: result.added, alreadyMember: result.alreadyMember, invalid: result.invalid },
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "internal error";
    if (message.startsWith("group not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
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
    const body = (await request.json()) as { groupId?: string; userId?: string; role?: string };
    if (!body.groupId || !body.userId || !body.role) {
      return NextResponse.json({ error: "groupId, userId, and role are required" }, { status: 400 });
    }
    if (body.role !== "member" && body.role !== "owner") {
      return NextResponse.json({ error: "role must be 'member' or 'owner'" }, { status: 400 });
    }

    await setGroupMemberRole(ctx.orgId, body.groupId, body.userId, body.role);
    logAudit({
      orgId: ctx.orgId,
      action: "group.member.role",
      resourceType: "group",
      resourceId: body.groupId,
      actorType: "user",
      actorId: ctx.userId,
      metadata: { userId: body.userId, role: body.role },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "internal error";
    if (message.startsWith("group not found") || message.startsWith("user is not")) {
      return NextResponse.json({ error: message }, { status: 404 });
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
    const body = (await request.json()) as { groupId?: string; userId?: string };
    if (!body.groupId || !body.userId) {
      return NextResponse.json({ error: "groupId and userId are required" }, { status: 400 });
    }

    await removeGroupMember(ctx.orgId, body.groupId, body.userId);
    logAudit({
      orgId: ctx.orgId,
      action: "group.member.remove",
      resourceType: "group",
      resourceId: body.groupId,
      actorType: "user",
      actorId: ctx.userId,
      metadata: { userId: body.userId },
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
