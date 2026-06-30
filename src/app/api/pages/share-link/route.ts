import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
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
    return NextResponse.json({ error: "share links not available in this auth mode" }, { status: 501 });
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

    const links = await db.shareLink.findMany({
      where: { pageId: pageWithAccess.id, revokedAt: null },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(
      links.map((l) => ({
        id: l.id,
        token: l.token,
        role: l.role,
        expiresAt: l.expiresAt,
        createdBy: l.createdBy,
        createdAt: l.createdAt,
      }))
    );
  } catch (e) {
    if (e instanceof PageAccessError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("share-link GET error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!isShareFeatureEnabled()) {
    return NextResponse.json({ error: "share links not available in this auth mode" }, { status: 501 });
  }

  try {
    const body = (await request.json()) as {
      slug?: string;
      role?: string;
      expiresInHours?: number;
    };

    if (!body.slug) {
      return NextResponse.json({ error: "slug is required" }, { status: 400 });
    }

    const linkRole = body.role ?? "viewer";
    if (linkRole !== "viewer" && linkRole !== "editor") {
      return NextResponse.json({ error: "role must be 'viewer' or 'editor'" }, { status: 400 });
    }

    const pageWithAccess = await getPageOrThrow(ctx.orgId, body.slug, ctx.userId, ctx.role);

    if (pageWithAccess.createdBy !== ctx.userId && ctx.role !== "owner" && ctx.role !== "admin") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const token = randomBytes(32).toString("base64url");
    const expiresAt = body.expiresInHours
      ? new Date(Date.now() + body.expiresInHours * 3600000)
      : null;

    const link = await db.shareLink.create({
      data: {
        pageId: pageWithAccess.id,
        token,
        role: linkRole,
        expiresAt,
        createdBy: ctx.userId,
      },
    });

    logAudit({
      orgId: ctx.orgId,
      action: "link.create",
      resourceType: "page",
      resourceId: pageWithAccess.id,
      actorId: ctx.userId,
      metadata: { slug: body.slug, role: linkRole, expiresAt },
    });

    return NextResponse.json({
      id: link.id,
      token: link.token,
      role: link.role,
      expiresAt: link.expiresAt,
    }, { status: 201 });
  } catch (e) {
    if (e instanceof PageAccessError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("share-link POST error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!isShareFeatureEnabled()) {
    return NextResponse.json({ error: "share links not available in this auth mode" }, { status: 501 });
  }

  try {
    const body = (await request.json()) as { linkId?: string };

    if (!body.linkId) {
      return NextResponse.json({ error: "linkId is required" }, { status: 400 });
    }

    const link = await db.shareLink.findUnique({
      where: { id: body.linkId },
      include: { page: { select: { orgId: true, slug: true, createdBy: true } } },
    });

    if (!link || link.page.orgId !== ctx.orgId) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    if (link.page.createdBy !== ctx.userId && ctx.role !== "owner" && ctx.role !== "admin") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    await db.shareLink.update({
      where: { id: body.linkId },
      data: { revokedAt: new Date() },
    });

    logAudit({
      orgId: ctx.orgId,
      action: "link.revoke",
      resourceType: "page",
      resourceId: link.pageId,
      actorId: ctx.userId,
      metadata: { slug: link.page.slug },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("share-link DELETE error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
