// Recommended organization tags used to live inside the org's content-rules
// JSON as one reserved entry. They now derive from the Concept table: a
// Concept row of this org with isRecommended: true is a recommended tag.
// Concepts are org-owned, so recommending a term only ever touches this org's
// own row for it.

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
 * recommended (creating this org's Concept row if the term doesn't exist yet)
 * and un-recommends anything this org previously recommended that isn't in
 * the new list. Only this org's rows are read or written. Returns the
 * resulting list.
 */
export async function withOrgTags(orgId: string, tags: string[]): Promise<string[]> {
  const cleaned = [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
  const normalizedTargets = new Set(cleaned.map((t) => normalizeTerm(t)).filter(Boolean));

  const current = await db.concept.findMany({ where: { orgId, isRecommended: true } });
  for (const c of current) {
    if (!normalizedTargets.has(c.normalizedName)) {
      await db.concept.update({ where: { id: c.id }, data: { isRecommended: false } });
    }
  }

  for (const term of cleaned) {
    const normalized = normalizeTerm(term);
    if (!normalized) continue;

    await db.concept.upsert({
      where: { orgId_normalizedName: { orgId, normalizedName: normalized } },
      update: { isRecommended: true },
      create: {
        orgId,
        normalizedName: normalized,
        displayName: normalized,
        isRecommended: true,
        usageCount: 0,
      },
    });
  }

  return extractOrgTags(orgId);
}
