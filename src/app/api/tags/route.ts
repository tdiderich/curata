import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { normalizeTerm, upsertConcepts, isConceptRel, CONCEPT_RELS } from "@/lib/concepts";
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

  let body: { pageId?: string; tags?: Array<string | { term?: string; kind?: string; rel?: string }> };
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
      // rel is optional; when present it sets the edge type (the Tags tab's
      // rel picker). Absent leaves whatever the edge already has.
      const rel = typeof raw.rel === "string" && raw.rel.trim() ? raw.rel.trim() : undefined;
      return { term, kind, rel };
    })
    .filter((t) => t.term)
    .slice(0, 20);
  if (!pageId || cleaned.length === 0) {
    return NextResponse.json({ error: "pageId and at least one tag required" }, { status: 400 });
  }
  const badRel = cleaned.find((t) => t.rel !== undefined && !isConceptRel(t.rel));
  if (badRel) {
    return NextResponse.json({ error: `rel must be one of ${CONCEPT_RELS.join(", ")}` }, { status: 400 });
  }

  const page = await db.page.findFirst({
    where: { id: pageId, orgId: ctx.orgId },
    select: { id: true, slug: true },
  });
  if (!page) {
    return NextResponse.json({ error: "page not found" }, { status: 404 });
  }

  await upsertConcepts(page.id, cleaned.map((t) => ({ term: t.term, kind: t.kind, rel: t.rel as import("@/lib/concepts").ConceptRel | undefined })), ctx.userId);
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
