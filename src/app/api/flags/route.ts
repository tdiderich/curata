import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";

// Cleanup queue: agents file flags via MCP flag_page; humans disposition them
// here. GET returns the pending queue with page context; PATCH executes one
// disposition (archive / delete / keep / snooze).

export async function GET() {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const flags = await db.pageFlag.findMany({
    where: {
      page: { orgId: ctx.orgId },
      OR: [
        { status: "pending" },
        // Snoozes that have lapsed come back to the queue.
        { status: "snoozed", snoozeUntil: { lte: now } },
      ],
    },
    orderBy: { createdAt: "desc" },
    include: {
      page: {
        select: {
          slug: true,
          title: true,
          status: true,
          viewCount: true,
          updatedAt: true,
          lastViewedAt: true,
          folder: { select: { name: true } },
        },
      },
    },
  });

  const lastSweep = await db.pageFlag.findFirst({
    orderBy: { createdAt: "desc" },
    where: { page: { orgId: ctx.orgId } },
    select: { createdAt: true },
  });

  return NextResponse.json({
    flags: flags.map((f) => ({
      id: f.id,
      slug: f.page.slug,
      title: f.page.title,
      folderName: f.page.folder?.name ?? null,
      pageStatus: f.page.status,
      viewCount: f.page.viewCount,
      contentUpdatedAt: f.page.updatedAt,
      lastViewedAt: f.page.lastViewedAt,
      action: f.action,
      reason: f.reason,
      evidence: f.evidence,
      supersededBy: f.supersededBy,
      confidence: f.confidence,
      flaggedBy: f.actorId,
      flaggedAt: f.createdAt,
    })),
    lastSweepAt: lastSweep?.createdAt ?? null,
  });
}

export async function PATCH(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!can(ctx.role, "page:edit", true)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const body = (await request.json()) as { flagId?: string; disposition?: string };
    if (!body.flagId) {
      return NextResponse.json({ error: "flagId is required" }, { status: 400 });
    }
    const DISPOSITIONS = ["archive", "delete", "keep", "snooze"];
    if (!body.disposition || !DISPOSITIONS.includes(body.disposition)) {
      return NextResponse.json(
        { error: `disposition must be one of: ${DISPOSITIONS.join(", ")}` },
        { status: 400 }
      );
    }

    const flag = await db.pageFlag.findFirst({
      where: { id: body.flagId, page: { orgId: ctx.orgId } },
      include: { page: { select: { id: true, slug: true } } },
    });
    if (!flag) {
      return NextResponse.json({ error: "flag not found" }, { status: 404 });
    }

    const resolution = { resolvedBy: ctx.userId, resolvedAt: new Date() };

    switch (body.disposition) {
      case "archive": {
        await db.$transaction([
          db.page.update({
            where: { id: flag.page.id },
            data: {
              status: "archived",
              ...(flag.supersededBy ? { supersededBy: flag.supersededBy } : {}),
            },
          }),
          db.pageFlag.updateMany({
            where: { pageId: flag.page.id, status: "pending" },
            data: { status: "resolved", ...resolution },
          }),
        ]);
        break;
      }
      case "delete": {
        // Hard delete — cascades flags, versions, annotations.
        await db.page.delete({ where: { id: flag.page.id } });
        break;
      }
      case "keep": {
        await db.$transaction([
          db.pageFlag.update({
            where: { id: flag.id },
            data: { status: "kept", ...resolution },
          }),
          db.page.update({
            where: { id: flag.page.id },
            data: { status: "active" },
          }),
        ]);
        break;
      }
      case "snooze": {
        const snoozeUntil = new Date(Date.now() + 30 * 86400000);
        await db.pageFlag.update({
          where: { id: flag.id },
          data: { status: "snoozed", snoozeUntil, ...resolution },
        });
        break;
      }
    }

    logAudit({
      orgId: ctx.orgId,
      action: `flag.${body.disposition}`,
      resourceType: "page",
      resourceId: flag.page.slug,
      actorType: "user",
      actorId: ctx.userId,
      metadata: { flagId: flag.id, reason: flag.reason },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("flags error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
