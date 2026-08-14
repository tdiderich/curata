import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/auth";
import { can, type Role } from "@/lib/permissions";
import { db } from "@/lib/db";
import { normalizeTerm } from "@/lib/concepts";
import { DEFAULT_KIND, isCuratedKind } from "@/lib/concept-kinds";
import { logAudit } from "@/lib/audit";

/**
 * Org-scoped concept ("Tags tab") management — distinct from /api/tags
 * (per-page add/remove, any member) and /api/org-tags (the JSON-stored
 * "recommended tags" list). Gated the same as Content Rules: owner/admin
 * only, since rename/kind edits ripple to every page that carries the tag.
 */

function requireManage(role: Role) {
  return can(role, "rules:manage");
}

/** Lists every concept used by at least one active page in this org, with a per-org page count. */
export async function GET() {
  const ctx = await resolveOrg();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!requireManage(ctx.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const concepts = await db.concept.findMany({
    where: { pages: { some: { page: { orgId: ctx.orgId, status: "active" } } } },
    select: {
      id: true,
      displayName: true,
      kind: true,
      pages: {
        where: { page: { orgId: ctx.orgId, status: "active" } },
        select: { id: true },
      },
    },
    orderBy: { displayName: "asc" },
    take: 500,
  });

  return NextResponse.json({
    concepts: concepts.map((c) => ({
      id: c.id,
      term: c.displayName,
      kind: c.kind || DEFAULT_KIND,
      pageCount: c.pages.length,
    })),
  });
}

/** Creates a standalone concept (not yet attached to any page). */
export async function POST(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!requireManage(ctx.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body: { term?: string; kind?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const normalized = typeof body.term === "string" ? normalizeTerm(body.term) : "";
  if (!normalized) return NextResponse.json({ error: "term is required" }, { status: 400 });
  const kind = typeof body.kind === "string" && isCuratedKind(body.kind) ? body.kind : DEFAULT_KIND;

  const existing = await db.concept.findUnique({ where: { normalizedName: normalized } });
  if (existing) {
    return NextResponse.json({ error: "a tag with that name already exists" }, { status: 409 });
  }

  const concept = await db.concept.create({
    data: { normalizedName: normalized, displayName: normalized, kind, usageCount: 0 },
  });
  logAudit({
    orgId: ctx.orgId,
    action: "create_concept",
    resourceType: "concept",
    resourceId: concept.id,
    actorId: ctx.userId,
    metadata: { term: concept.displayName, kind: concept.kind },
  }).catch(() => {});

  return NextResponse.json({
    concept: { id: concept.id, term: concept.displayName, kind: concept.kind || DEFAULT_KIND, pageCount: 0 },
  });
}

/** Renames a tag's term and/or changes its kind. */
export async function PATCH(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!requireManage(ctx.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body: { conceptId?: string; term?: string; kind?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { conceptId } = body;
  if (!conceptId) return NextResponse.json({ error: "conceptId is required" }, { status: 400 });

  const concept = await db.concept.findUnique({ where: { id: conceptId } });
  if (!concept) return NextResponse.json({ error: "tag not found" }, { status: 404 });

  // Concept rows aren't org-scoped in the schema (a single OSS org today, but
  // shared across orgs on the cloud multi-tenant build) — confirm this org
  // actually uses the tag before letting it rename/re-kind a row that
  // happens to belong to someone else's pages.
  const usedByOrg = await db.pageConcept.findFirst({
    where: { conceptId, page: { orgId: ctx.orgId, status: "active" } },
  });
  if (!usedByOrg) return NextResponse.json({ error: "tag not used by this organization" }, { status: 404 });

  const data: { normalizedName?: string; displayName?: string; kind?: string } = {};

  if (body.term !== undefined) {
    const normalized = normalizeTerm(body.term);
    if (!normalized) return NextResponse.json({ error: "term is required" }, { status: 400 });
    if (normalized !== concept.normalizedName) {
      const collision = await db.concept.findUnique({ where: { normalizedName: normalized } });
      if (collision) {
        return NextResponse.json(
          { error: "a tag with that name already exists — merging tags isn't supported yet" },
          { status: 409 }
        );
      }
      data.normalizedName = normalized;
      data.displayName = normalized;
    }
  }

  if (body.kind !== undefined) {
    data.kind = typeof body.kind === "string" && isCuratedKind(body.kind) ? body.kind : "";
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const updated = await db.concept.update({ where: { id: conceptId }, data });
  logAudit({
    orgId: ctx.orgId,
    action: "update_concept",
    resourceType: "concept",
    resourceId: concept.id,
    actorId: ctx.userId,
    metadata: { before: { term: concept.displayName, kind: concept.kind }, after: { term: updated.displayName, kind: updated.kind } },
  }).catch(() => {});

  const pageCount = await db.pageConcept.count({ where: { conceptId, page: { orgId: ctx.orgId, status: "active" } } });
  return NextResponse.json({
    concept: { id: updated.id, term: updated.displayName, kind: updated.kind || DEFAULT_KIND, pageCount },
  });
}

/**
 * Detaches a tag from every active page in this org and recomputes its
 * usage count. The Concept row itself is never hard-deleted here — it's a
 * globally shared table (upsertConcepts' own remove path follows the same
 * rule) and another org's pages, or a future re-tag, may still reference it.
 */
export async function DELETE(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!requireManage(ctx.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const conceptId = request.nextUrl.searchParams.get("conceptId");
  if (!conceptId) return NextResponse.json({ error: "conceptId param required" }, { status: 400 });

  const concept = await db.concept.findUnique({ where: { id: conceptId } });
  if (!concept) return NextResponse.json({ error: "tag not found" }, { status: 404 });

  const orgPageConcepts = await db.pageConcept.findMany({
    where: { conceptId, page: { orgId: ctx.orgId } },
    select: { id: true },
  });
  if (orgPageConcepts.length === 0) {
    return NextResponse.json({ error: "tag not used by this organization" }, { status: 404 });
  }

  await db.pageConcept.deleteMany({ where: { id: { in: orgPageConcepts.map((pc) => pc.id) } } });
  const usageCount = await db.pageConcept.count({ where: { conceptId } });
  await db.concept.update({ where: { id: conceptId }, data: { usageCount } });

  logAudit({
    orgId: ctx.orgId,
    action: "detach_concept",
    resourceType: "concept",
    resourceId: conceptId,
    actorId: ctx.userId,
    metadata: { term: concept.displayName, detachedPages: orgPageConcepts.length },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
