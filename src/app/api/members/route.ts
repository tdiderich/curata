import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";

export async function GET() {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const members = await db.orgMember.findMany({
      where: { orgId: ctx.orgId },
      orderBy: { role: "asc" },
    });

    return NextResponse.json(
      members.map((m) => ({
        id: m.id,
        userId: m.userId,
        email: null,
        role: m.role,
      }))
    );
  } catch (err) {
    console.error("members error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!can(ctx.role, "member:manage")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const body = (await request.json()) as { memberId?: string; role?: string };

    if (!body.memberId || !body.role) {
      return NextResponse.json(
        { error: "memberId and role are required" },
        { status: 400 }
      );
    }

    const validRoles = ["owner", "admin", "member", "viewer"];
    if (!validRoles.includes(body.role)) {
      return NextResponse.json({ error: "invalid role" }, { status: 400 });
    }

    const member = await db.orgMember.findFirst({
      where: { id: body.memberId, orgId: ctx.orgId },
    });

    if (!member) {
      return NextResponse.json({ error: "member not found" }, { status: 404 });
    }

    if (body.role === "owner" && ctx.role !== "owner") {
      return NextResponse.json({ error: "Only the owner can transfer ownership" }, { status: 403 });
    }

    let updated: { id: string; role: string };
    try {
      updated = await db.$transaction(async (tx) => {
        const ownerCount = await tx.orgMember.count({ where: { orgId: ctx.orgId, role: "owner" } });
        if (ownerCount <= 1 && member.role === "owner" && body.role !== "owner") {
          throw new Error("Cannot demote the last owner");
        }
        return tx.orgMember.update({ where: { id: body.memberId }, data: { role: body.role } });
      });
    } catch (txErr: unknown) {
      const message = txErr instanceof Error ? txErr.message : "internal error";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json({ id: updated.id, role: updated.role });
  } catch (err) {
    console.error("members error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!can(ctx.role, "member:manage")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const body = (await request.json()) as { memberId?: string };

    if (!body.memberId) {
      return NextResponse.json({ error: "memberId is required" }, { status: 400 });
    }

    const member = await db.orgMember.findFirst({
      where: { id: body.memberId, orgId: ctx.orgId },
    });

    if (!member) {
      return NextResponse.json({ error: "member not found" }, { status: 404 });
    }

    if (member.userId === ctx.userId) {
      return NextResponse.json({ error: "cannot remove yourself" }, { status: 400 });
    }

    await db.orgMember.delete({ where: { id: body.memberId } });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("members error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
