// Recommended organization tags used to live inside the org's global
// content-rules JSON as one reserved entry. They now derive from the Concept
// table instead: a Concept row with isRecommended: true and orgId set to this
// org is a recommended tag. Concepts stay globally shared for page tagging -
// orgId/isRecommended here only annotate which org (if any) currently
// recommends a given term, they don't fence who can attach it to a page.

import { db } from "./db";
import { normalizeTerm } from "./concepts";

// Kept around for content-rules.ts / mcp-instructions.ts, which still filter
// this id out of legacy org.rules JSON that hasn't been migrated yet (see
// scripts/migrate-org-tags.ts).
export const ORG_TAGS_RULE_ID = "org-tags";

/** Reads the recommended tag list for an org out of the Concept table. */
export async function extractOrgTags(orgId: string): Promise<string[]> {
  const rows = await db.concept.findMany({
    where: { orgId, isRecommended: true },
    select: { displayName: true },
    orderBy: { displayName: "asc" },
  });
  return rows.map((r) => r.displayName);
}

/**
 * Replaces the recommended list for an org: marks the given terms
 * recommended (creating a Concept row if the term doesn't exist yet) and
 * un-recommends anything this org previously recommended that isn't in the
 * new list. Returns the resulting list.
 *
 * Note: a globally-shared term can only be "recommended" by one org at a
 * time today (isRecommended/orgId live on the single Concept row for that
 * name) - the same limitation the codebase already accepts elsewhere for
 * Concept not being fully org-scoped (see app/api/tags/org/route.ts).
 */
export async function withOrgTags(orgId: string, tags: string[]): Promise<string[]> {
  const cleaned = [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
  const normalizedTargets = new Set(cleaned.map((t) => normalizeTerm(t)).filter(Boolean));

  const current = await db.concept.findMany({ where: { orgId, isRecommended: true } });
  for (const c of current) {
    if (!normalizedTargets.has(c.normalizedName)) {
      await db.concept.update({ where: { id: c.id }, data: { isRecommended: false, orgId: null } });
    }
  }

  for (const term of cleaned) {
    const normalized = normalizeTerm(term);
    if (!normalized) continue;

    const existing = await db.concept.findUnique({ where: { normalizedName: normalized } });
    if (existing) {
      await db.concept.update({
        where: { id: existing.id },
        data: { isRecommended: true, orgId },
      });
    } else {
      await db.concept.create({
        data: {
          normalizedName: normalized,
          displayName: normalized,
          isRecommended: true,
          orgId,
          usageCount: 0,
        },
      });
    }
  }

  return extractOrgTags(orgId);
}
