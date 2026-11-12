import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/auth";
import { can, type Role } from "@/lib/permissions";
import { db } from "@/lib/db";
import { normalizeTerm } from "@/lib/concepts";
import { DEFAULT_KIND, isCuratedKind } from "@/lib/concept-kinds";
import { logAudit } from "@/lib/audit";
import { Prisma } from "@/generated/prisma/client";

/**
 * Org-scoped concept ("Tags tab") management — distinct from /api/tags
 * (per-page add/remove, any member) and /api/org-tags (the "recommended
 * tags" list). Gated the same as Content Rules: owner/admin only, since
 * rename/kind edits ripple to every page that carries the tag. Concepts are
 * owned by one org, so every handler only sees and changes the caller's rows;
 * another org's tag id answers "tag not found".
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
    where: { orgId: ctx.orgId, pages: { some: { page: { status: "active" } } } },
    select: {
      id: true,
      displayName: true,
      kind: true,
      pages: {
        where: { page: { status: "active" } },
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

  const existing = await db.concept.findUnique({ where: { orgId_normalizedName: { orgId: ctx.orgId, normalizedName: normalized } } });
  if (existing) {
    return NextResponse.json({ error: "a tag with that name already exists" }, { status: 409 });
  }

  const concept = await db.concept.create({
    data: { orgId: ctx.orgId, normalizedName: normalized, displayName: normalized, kind, usageCount: 0 },
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

  const concept = await db.concept.findFirst({ where: { id: conceptId, orgId: ctx.orgId } });
  if (!concept) return NextResponse.json({ error: "tag not found" }, { status: 404 });

  const data: { normalizedName?: string; displayName?: string; kind?: string } = {};

  if (body.term !== undefined) {
    const normalized = normalizeTerm(body.term);
    if (!normalized) return NextResponse.json({ error: "term is required" }, { status: 400 });
    if (normalized !== concept.normalizedName) {
      const collision = await db.concept.findUnique({ where: { orgId_normalizedName: { orgId: ctx.orgId, normalizedName: normalized } } });
      if (collision) {
        return NextResponse.json(
          { error: "a tag with that name already exists - use Merge instead" },
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

  let updated;
  try {
    updated = await db.concept.update({ where: { id: conceptId }, data });
  } catch (err) {
    // The findUnique collision check above isn't atomic with this update —
    // a concurrent PATCH can rename another concept to the same term in
    // between. Fall back to the same 409 the pre-check returns instead of
    // letting the unique-constraint violation surface as a 500.
    if (data.normalizedName && err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        { error: "a tag with that name already exists - use Merge instead" },
        { status: 409 }
      );
    }
    throw err;
  }
  logAudit({
    orgId: ctx.orgId,
    action: "update_concept",
    resourceType: "concept",
    resourceId: concept.id,
    actorId: ctx.userId,
    metadata: { before: { term: concept.displayName, kind: concept.kind }, after: { term: updated.displayName, kind: updated.kind } },
  }).catch(() => {});

  const pageCount = await db.pageConcept.count({ where: { conceptId, page: { status: "active" } } });
  return NextResponse.json({
    concept: { id: updated.id, term: updated.displayName, kind: updated.kind || DEFAULT_KIND, pageCount },
  });
}

/**
 * Merges source concept into target: PageConcept rows reassigned (deduped),
 * usage recomputed, source row hard-deleted.
 */
export async function PUT(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!requireManage(ctx.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body: { sourceConceptId?: string; targetConceptId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { sourceConceptId, targetConceptId } = body;
  if (!sourceConceptId || !targetConceptId) {
    return NextResponse.json({ error: "sourceConceptId and targetConceptId are required" }, { status: 400 });
  }
  if (sourceConceptId === targetConceptId) {
    return NextResponse.json({ error: "cannot merge a tag into itself" }, { status: 400 });
  }

  const [source, target] = await Promise.all([
    db.concept.findFirst({ where: { id: sourceConceptId, orgId: ctx.orgId } }),
    db.concept.findFirst({ where: { id: targetConceptId, orgId: ctx.orgId } }),
  ]);
  if (!source) return NextResponse.json({ error: "source tag not found" }, { status: 404 });
  if (!target) return NextResponse.json({ error: "target tag not found" }, { status: 404 });

  const updated = await db.$transaction(async (tx) => {
    const sourcePageConcepts = await tx.pageConcept.findMany({ where: { conceptId: sourceConceptId } });

    for (const pc of sourcePageConcepts) {
      const targetHasPage = await tx.pageConcept.findFirst({
        where: { conceptId: targetConceptId, pageId: pc.pageId },
      });
      if (targetHasPage) {
        await tx.pageConcept.delete({ where: { id: pc.id } });
      } else {
        await tx.pageConcept.update({ where: { id: pc.id }, data: { conceptId: targetConceptId } });
      }
    }

    const usageCount = await tx.pageConcept.count({ where: { conceptId: targetConceptId } });
    const mergedTarget = await tx.concept.update({ where: { id: targetConceptId }, data: { usageCount } });
    await tx.concept.delete({ where: { id: sourceConceptId } });

    return mergedTarget;
  });

  logAudit({
    orgId: ctx.orgId,
    action: "merge_concept",
    resourceType: "concept",
    resourceId: targetConceptId,
    actorId: ctx.userId,
    metadata: { source: { id: sourceConceptId, term: source.displayName }, target: { id: targetConceptId, term: updated.displayName } },
  }).catch(() => {});

  const pageCount = await db.pageConcept.count({ where: { conceptId: targetConceptId, page: { status: "active" } } });
  return NextResponse.json({
    concept: { id: updated.id, term: updated.displayName, kind: updated.kind || DEFAULT_KIND, pageCount },
  });
}

/**
 * Detaches a tag from every active page in this org and recomputes its
 * usage count. The Concept row itself is never hard-deleted here
 * (upsertConcepts' own remove path follows the same rule), so a recommended
 * flag or a future re-tag keeps its row.
 */
export async function DELETE(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!requireManage(ctx.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const conceptId = request.nextUrl.searchParams.get("conceptId");
  if (!conceptId) return NextResponse.json({ error: "conceptId param required" }, { status: 400 });

  const concept = await db.concept.findFirst({ where: { id: conceptId, orgId: ctx.orgId } });
  if (!concept) return NextResponse.json({ error: "tag not found" }, { status: 404 });

  const orgPageConcepts = await db.pageConcept.findMany({
    where: { conceptId },
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
