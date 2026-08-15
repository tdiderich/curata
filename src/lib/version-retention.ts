import { db } from "./db";

/// Version retention policy (decided by Tyler, 2026-08-15): every page always
/// keeps its trusted version (Page.trustedVersionId) and its newest version,
/// no matter how old either one is. Every other version older than
/// RETENTION_DAYS is deleted. The AuditLog is never touched by pruning — it
/// records who trusted/untrusted/restored what and when, and that provenance
/// survives even after the PageVersion row it references is gone.
export const RETENTION_DAYS = 30;

const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

// Sweep processes pages this many at a time so a large org's weekly sweep
// doesn't hold one giant transaction or issue one round trip per page with
// no concurrency at all.
const SWEEP_BATCH_SIZE = 50;

/**
 * Delete `pageId`'s versions older than RETENTION_DAYS, excluding the page's
 * trusted version (if any) and its current newest version. Returns the
 * number of versions deleted.
 *
 * Callers that create a new version and then prune (the normal write path)
 * must prune AFTER the new version is committed, so "newest" unambiguously
 * means the version that was just written rather than whatever it replaced.
 */
export async function pruneVersions(pageId: string): Promise<number> {
  const page = await db.page.findUnique({
    where: { id: pageId },
    select: { trustedVersionId: true },
  });
  if (!page) return 0;

  const latest = await db.pageVersion.findFirst({
    where: { pageId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!latest) return 0;

  const keepIds = [latest.id];
  if (page.trustedVersionId) keepIds.push(page.trustedVersionId);

  const cutoff = new Date(Date.now() - RETENTION_MS);

  const result = await db.pageVersion.deleteMany({
    where: {
      pageId,
      id: { notIn: keepIds },
      createdAt: { lt: cutoff },
    },
  });

  return result.count;
}

/**
 * Same policy across every page in an org. deleteMany can't express "keep
 * the newest and the trusted version per page" across a whole org in one
 * statement, so this still runs pruneVersions per page — batched
 * SWEEP_BATCH_SIZE at a time (concurrently within a batch, sequentially
 * across batches) so a large org's weekly sweep stays bounded instead of
 * firing hundreds of queries at once. Returns the total versions deleted.
 */
export async function sweepVersions(orgId: string): Promise<number> {
  const pages = await db.page.findMany({
    where: { orgId },
    select: { id: true },
  });

  let total = 0;
  for (let i = 0; i < pages.length; i += SWEEP_BATCH_SIZE) {
    const batch = pages.slice(i, i + SWEEP_BATCH_SIZE);
    const counts = await Promise.all(batch.map((p) => pruneVersions(p.id)));
    total += counts.reduce((sum, c) => sum + c, 0);
  }
  return total;
}
