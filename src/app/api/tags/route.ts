import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { upsertConcepts } from "@/lib/concepts";
import { logAudit } from "@/lib/audit";

/** Adds concept tags to a page — the dashboard untagged queue's inline tagger. */
export async function POST(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { pageId?: string; tags?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { pageId, tags } = body;
  const cleaned = (Array.isArray(tags) ? tags : [])
    .map((t) => (typeof t === "string" ? t.trim() : ""))
    .filter(Boolean)
    .slice(0, 20);
  if (!pageId || cleaned.length === 0) {
    return NextResponse.json({ error: "pageId and at least one tag required" }, { status: 400 });
  }

  const page = await db.page.findFirst({
    where: { id: pageId, orgId: ctx.orgId },
    select: { id: true, slug: true },
  });
  if (!page) {
    return NextResponse.json({ error: "page not found" }, { status: 404 });
  }

  await upsertConcepts(page.id, cleaned.map((term) => ({ term, kind: "topic" })), ctx.userId);
  logAudit({
    orgId: ctx.orgId,
    action: "tag_page",
    resourceType: "page",
    resourceId: page.slug,
    actorId: ctx.userId,
    metadata: { tags: cleaned },
  }).catch(() => {});

  return NextResponse.json({ ok: true, tagged: cleaned });
}

/** Removes one tag from a page. */
export async function DELETE(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { pageId?: string; tag?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { pageId, tag } = body;
  if (!pageId || !tag || typeof tag !== "string") {
    return NextResponse.json({ error: "pageId and tag required" }, { status: 400 });
  }

  const page = await db.page.findFirst({
    where: { id: pageId, orgId: ctx.orgId },
    select: { id: true, slug: true },
  });
  if (!page) {
    return NextResponse.json({ error: "page not found" }, { status: 404 });
  }

  const normalized = tag.trim().toLowerCase();
  const concept = await db.concept.findUnique({ where: { normalizedName: normalized } });
  if (concept) {
    await db.pageConcept.deleteMany({ where: { pageId: page.id, conceptId: concept.id } });
  }
  logAudit({
    orgId: ctx.orgId,
    action: "untag_page",
    resourceType: "page",
    resourceId: page.slug,
    actorId: ctx.userId,
    metadata: { tag: normalized },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
