import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { normalizeTerm, upsertConcepts } from "@/lib/concepts";
import { logAudit } from "@/lib/audit";
import { DEFAULT_KIND } from "@/lib/concept-kinds";

/**
 * Adds or re-kinds concept tags on a page — the dashboard untagged queue's
 * inline tagger and the page detail chip row. Tags may be plain strings
 * (kind defaults to topic) or { term, kind } objects.
 */
export async function POST(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { pageId?: string; tags?: Array<string | { term?: string; kind?: string }> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { pageId, tags } = body;
  const cleaned = (Array.isArray(tags) ? tags : [])
    .map((t) => {
      const raw = typeof t === "string" ? { term: t } : t && typeof t === "object" ? t : {};
      const term = typeof raw.term === "string" ? normalizeTerm(raw.term) : "";
      const kind =
        typeof raw.kind === "string" && raw.kind.trim()
          ? normalizeTerm(raw.kind)
          : DEFAULT_KIND;
      return { term, kind };
    })
    .filter((t) => t.term)
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

  await upsertConcepts(page.id, cleaned, ctx.userId);
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

  const normalized = normalizeTerm(tag);
  // Route through upsertConcepts' remove path so usage_count is recounted.
  await upsertConcepts(page.id, [{ term: normalized, remove: true }], ctx.userId);
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
