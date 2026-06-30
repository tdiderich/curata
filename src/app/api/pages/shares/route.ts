import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { isShareFeatureEnabled, getPageOrThrow, PageAccessError } from "@/lib/access";

export async function GET(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!isShareFeatureEnabled()) {
    return NextResponse.json({ error: "sharing not available in this auth mode" }, { status: 501 });
  }

  const slug = request.nextUrl.searchParams.get("slug");
  if (!slug) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  try {
    const pageWithAccess = await getPageOrThrow(ctx.orgId, slug, ctx.userId, ctx.role);

    if (pageWithAccess.createdBy !== ctx.userId && ctx.role !== "owner" && ctx.role !== "admin") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const shares = await db.pageShare.findMany({
      where: { pageId: pageWithAccess.id },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json(
      shares.map((s) => ({
        id: s.id,
        userId: s.userId,
        role: s.role,
        invitedBy: s.invitedBy,
        createdAt: s.createdAt,
      }))
    );
  } catch (e) {
    if (e instanceof PageAccessError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("shares GET error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!isShareFeatureEnabled()) {
    return NextResponse.json({ error: "sharing not available in this auth mode" }, { status: 501 });
  }

  try {
    const body = (await request.json()) as {
      slug?: string;
      userId?: string;
      role?: string;
    };

    if (!body.slug || !body.userId) {
      return NextResponse.json({ error: "slug and userId are required" }, { status: 400 });
    }

    const shareRole = body.role ?? "viewer";
    if (shareRole !== "viewer" && shareRole !== "editor") {
      return NextResponse.json({ error: "role must be 'viewer' or 'editor'" }, { status: 400 });
    }

    const pageWithAccess = await getPageOrThrow(ctx.orgId, body.slug, ctx.userId, ctx.role);

    if (pageWithAccess.createdBy !== ctx.userId && ctx.role !== "owner" && ctx.role !== "admin") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const targetMember = await db.orgMember.findFirst({
      where: { orgId: ctx.orgId, userId: body.userId },
    });
    if (!targetMember) {
      return NextResponse.json(
        { error: "user must be a member of this organization" },
        { status: 400 }
      );
    }

    if (body.userId === ctx.userId) {
      return NextResponse.json({ error: "cannot share with yourself" }, { status: 400 });
    }

    const share = await db.pageShare.upsert({
      where: { pageId_userId: { pageId: pageWithAccess.id, userId: body.userId } },
      update: { role: shareRole },
      create: {
        pageId: pageWithAccess.id,
        userId: body.userId,
        role: shareRole,
        invitedBy: ctx.userId,
      },
    });

    logAudit({
      orgId: ctx.orgId,
      action: "share.create",
      resourceType: "page",
      resourceId: pageWithAccess.id,
      actorId: ctx.userId,
      metadata: { targetUserId: body.userId, role: shareRole, slug: body.slug },
    });

    return NextResponse.json({
      id: share.id,
      userId: share.userId,
      role: share.role,
    }, { status: 201 });
  } catch (e) {
    if (e instanceof PageAccessError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("shares POST error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!isShareFeatureEnabled()) {
    return NextResponse.json({ error: "sharing not available in this auth mode" }, { status: 501 });
  }

  try {
    const body = (await request.json()) as { shareId?: string };

    if (!body.shareId) {
      return NextResponse.json({ error: "shareId is required" }, { status: 400 });
    }

    const share = await db.pageShare.findUnique({
      where: { id: body.shareId },
      include: { page: { select: { orgId: true, slug: true, createdBy: true } } },
    });

    if (!share || share.page.orgId !== ctx.orgId) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    if (share.page.createdBy !== ctx.userId && ctx.role !== "owner" && ctx.role !== "admin") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    await db.pageShare.delete({ where: { id: body.shareId } });

    logAudit({
      orgId: ctx.orgId,
      action: "share.revoke",
      resourceType: "page",
      resourceId: share.pageId,
      actorId: ctx.userId,
      metadata: { targetUserId: share.userId, slug: share.page.slug },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("shares DELETE error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
