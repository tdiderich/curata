import yaml from "js-yaml";
import { db } from "./db";
import { listPagesWhere } from "./access";
import { getReviewQueue } from "./pages";

const DEFAULT_WINDOW_DAYS = 7;
const DEFAULT_WINDOW_MS = DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const HOT_SPOT_LIMIT = 5;
const HOT_SPOT_MIN_VERSIONS = 2;

export interface DigestPageRef {
  slug: string;
  title: string;
}

export interface DigestConceptGroup {
  concept: string;
  pages: DigestPageRef[];
}

export interface DigestTrustFlip extends DigestPageRef {
  actorId: string;
  flippedAt: Date;
}

export interface DigestAwaitingReview extends DigestPageRef {
  versionsBehind: number;
}

export interface DigestHotSpot extends DigestPageRef {
  versionCount: number;
}

export interface DigestData {
  orgId: string;
  windowStart: Date;
  windowEnd: Date;
  newPagesByConcept: DigestConceptGroup[];
  uncategorizedNewPages: DigestPageRef[];
  // Distinct page counts — a page carrying two tags appears in two concept
  // groups, so summing group sizes overcounts; these are the real numbers.
  newPageCount: number;
  taggedNewPageCount: number;
  trustFlips: DigestTrustFlip[];
  awaitingReview: DigestAwaitingReview[];
  hotSpots: DigestHotSpot[];
}

/**
 * "Previous run" for window math, derived from the newest version among
 * pages already slugged digest-* — there is no separate timestamp column,
 * the digest pages themselves are the record of when the last run happened.
 * Null when this org has never generated a digest yet.
 */
export async function resolvePreviousDigestAt(orgId: string): Promise<Date | null> {
  const digestPages = await db.page.findMany({
    where: { orgId, slug: { startsWith: "digest-" } },
    select: {
      versions: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
    },
  });

  let latest: Date | null = null;
  for (const p of digestPages) {
    const createdAt = p.versions[0]?.createdAt;
    if (createdAt && (!latest || createdAt > latest)) latest = createdAt;
  }
  return latest;
}

/// Window runs from the previous digest run to now, falling back to a 7 day
/// lookback the first time an org generates a digest.
export function computeWindow(
  previousDigestAt: Date | null,
  now: Date
): { windowStart: Date; windowEnd: Date } {
  const windowStart = previousDigestAt ?? new Date(now.getTime() - DEFAULT_WINDOW_MS);
  return { windowStart, windowEnd: now };
}

/**
 * Gathers everything a digest reports on for one org: new pages grouped by
 * concept tag, trust flips read off the audit log (page.trust is written on
 * every markTrusted call already, so no schema change is needed to recover
 * who flipped what and when), pages whose trusted pointer has fallen behind
 * latest (awaiting review), and the most-edited pages in the window (hot
 * spots). Visibility is whatever listPagesWhere already grants this caller —
 * the same filter list_pages and search_pages use, not a second one invented
 * here.
 */
export async function gatherDigestData(
  orgId: string,
  userId?: string,
  now: Date = new Date()
): Promise<DigestData> {
  const previousDigestAt = await resolvePreviousDigestAt(orgId);
  const { windowStart, windowEnd } = computeWindow(previousDigestAt, now);

  const where = listPagesWhere(orgId, userId ?? null);
  const visiblePages = await db.page.findMany({
    where,
    select: { id: true, slug: true, title: true, createdAt: true, folderId: true },
  });
  const titleBySlug = new Map(visiblePages.map((p) => [p.slug, p.title]));
  const visibleSlugs = new Set(visiblePages.map((p) => p.slug));
  const pageById = new Map(visiblePages.map((p) => [p.id, p]));

  // Locked (curata-managed) folders hold seeded scaffolding — Templates,
  // Skills — not knowledge anyone wrote this week. Reporting those as "new
  // pages" (unresolved {{placeholder}} titles and all) or "hot spots" is
  // noise, so they're excluded from both scans. Digest pages themselves are
  // excluded too: a report that lists itself as news is never right.
  const lockedFolders = await db.folder.findMany({
    where: { orgId, locked: true },
    select: { id: true },
  });
  const lockedFolderIds = new Set(lockedFolders.map((f) => f.id));
  const scanPages = visiblePages.filter(
    (p) => !(p.folderId && lockedFolderIds.has(p.folderId)) && !p.slug.startsWith("digest-")
  );

  // New pages, grouped by concept tag. Lower bound is exclusive so the
  // previous digest run's own page (created exactly at windowStart) never
  // shows up as "new" in the report that follows it.
  const newPages = scanPages.filter(
    (p) => p.createdAt > windowStart && p.createdAt < windowEnd
  );
  const newPageIds = newPages.map((p) => p.id);
  const pageConcepts = newPageIds.length > 0
    ? await db.pageConcept.findMany({
        where: { pageId: { in: newPageIds } },
        select: { pageId: true, concept: { select: { displayName: true } } },
      })
    : [];
  const conceptsByPageId = new Map<string, string[]>();
  for (const c of pageConcepts) {
    const list = conceptsByPageId.get(c.pageId) ?? [];
    list.push(c.concept.displayName);
    conceptsByPageId.set(c.pageId, list);
  }
  const groupsByConcept = new Map<string, DigestPageRef[]>();
  const uncategorizedNewPages: DigestPageRef[] = [];
  for (const p of newPages) {
    const tags = conceptsByPageId.get(p.id) ?? [];
    const ref = { slug: p.slug, title: p.title };
    if (tags.length === 0) {
      uncategorizedNewPages.push(ref);
      continue;
    }
    for (const tag of tags) {
      const list = groupsByConcept.get(tag) ?? [];
      list.push(ref);
      groupsByConcept.set(tag, list);
    }
  }
  const newPagesByConcept = [...groupsByConcept.entries()]
    .map(([concept, pages]) => ({ concept, pages }))
    .sort((a, b) => a.concept.localeCompare(b.concept));

  // Trust flips: derived from the audit log's page.trust entries, filtered
  // to pages this caller can actually see.
  const trustAudits = await db.auditLog.findMany({
    where: { orgId, action: "page.trust", createdAt: { gt: windowStart, lt: windowEnd } },
    orderBy: { createdAt: "desc" },
  });
  const trustFlips: DigestTrustFlip[] = trustAudits
    .filter((a) => visibleSlugs.has(a.resourceId))
    .map((a) => ({
      slug: a.resourceId,
      title: titleBySlug.get(a.resourceId) ?? a.resourceId,
      actorId: a.actorId,
      flippedAt: a.createdAt,
    }));

  // Awaiting review: the trusted pointer exists but latest has moved past it.
  // Never-trusted pages are a different queue — this section is only for
  // pages whose latest moved ahead of trusted.
  const reviewQueue = await getReviewQueue(orgId, userId);
  const awaitingReview: DigestAwaitingReview[] = reviewQueue
    .filter((r) => !r.neverTrusted)
    .map((r) => ({ slug: r.slug, title: r.title, versionsBehind: r.versionsBehind }));

  // Hot spots: pages edited more than once inside the window.
  const versionsInWindow = scanPages.length > 0
    ? await db.pageVersion.findMany({
        where: {
          pageId: { in: scanPages.map((p) => p.id) },
          createdAt: { gt: windowStart, lt: windowEnd },
        },
        select: { pageId: true },
      })
    : [];
  const versionCountByPageId = new Map<string, number>();
  for (const v of versionsInWindow) {
    versionCountByPageId.set(v.pageId, (versionCountByPageId.get(v.pageId) ?? 0) + 1);
  }
  const hotSpots: DigestHotSpot[] = [...versionCountByPageId.entries()]
    .filter(([, count]) => count >= HOT_SPOT_MIN_VERSIONS)
    .map(([pageId, count]) => {
      const p = pageById.get(pageId)!;
      return { slug: p.slug, title: p.title, versionCount: count };
    })
    .sort((a, b) => b.versionCount - a.versionCount || a.slug.localeCompare(b.slug))
    .slice(0, HOT_SPOT_LIMIT);

  return {
    orgId,
    windowStart,
    windowEnd,
    newPagesByConcept,
    uncategorizedNewPages,
    newPageCount: newPages.length,
    taggedNewPageCount: newPages.filter((p) => (conceptsByPageId.get(p.id) ?? []).length > 0).length,
    trustFlips,
    awaitingReview,
    hotSpots,
  };
}

/// ISO 8601 week number (Monday-start week, week 1 contains the year's first
/// Thursday) — used so the digest slug is deterministic per calendar week
/// and regenerating mid-week updates the same page instead of duplicating it.
export function isoWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return { year: d.getUTCFullYear(), week };
}

export function digestSlug(date: Date): string {
  const { year, week } = isoWeek(date);
  return `digest-${year}-w${String(week).padStart(2, "0")}`;
}

export function digestTitle(date: Date): string {
  const { year, week } = isoWeek(date);
  return `Digest - Week ${week}, ${year}`;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function pageLink(orgSlug: string, ref: DigestPageRef): string {
  return `[${ref.title}](/p/${orgSlug}/${ref.slug})`;
}

/**
 * Renders the digest as page YAML: one section per area, each a plain
 * markdown body linking every entry back to its page slug. Sections always
 * render, even empty ones, so the shape of the page stays consistent week
 * to week.
 */
export function buildDigestPageYaml(data: DigestData, orgSlug: string, title: string): string {
  const totalNewPages = data.newPageCount;

  const overviewLines = [
    `Covering ${formatDate(data.windowStart)} to ${formatDate(data.windowEnd)}.`,
    "",
    `${totalNewPages} new page${totalNewPages === 1 ? "" : "s"}, ${data.trustFlips.length} trust flip${data.trustFlips.length === 1 ? "" : "s"}, ${data.awaitingReview.length} page${data.awaitingReview.length === 1 ? "" : "s"} awaiting review, ${data.hotSpots.length} hot spot${data.hotSpots.length === 1 ? "" : "s"}.`,
  ];
  // Tagging health: grouping quality depends entirely on upstream tag
  // discipline, so the digest says outright how much of this week's intake
  // was tagged instead of letting a flat Untagged bucket fail silently.
  if (totalNewPages > 0) {
    overviewLines.push(
      "",
      `${data.taggedNewPageCount} of ${totalNewPages} new page${totalNewPages === 1 ? "" : "s"} tagged${data.taggedNewPageCount === 0 ? " - tag pages so future digests can group them" : ""}.`
    );
  }

  const newPagesLines: string[] = [];
  if (totalNewPages === 0) {
    newPagesLines.push("No new pages this window.");
  } else {
    for (const group of data.newPagesByConcept) {
      newPagesLines.push(`**${group.concept}**`, "");
      for (const p of group.pages) newPagesLines.push(`- ${pageLink(orgSlug, p)}`);
      newPagesLines.push("");
    }
    if (data.uncategorizedNewPages.length > 0) {
      newPagesLines.push("**Untagged**", "");
      for (const p of data.uncategorizedNewPages) newPagesLines.push(`- ${pageLink(orgSlug, p)}`);
    }
  }

  const trustFlipLines = data.trustFlips.length === 0
    ? ["No trust flips this window."]
    : data.trustFlips.map(
        (f) => `- ${pageLink(orgSlug, f)} marked trusted by ${f.actorId} on ${formatDate(f.flippedAt)}`
      );

  const awaitingReviewLines = data.awaitingReview.length === 0
    ? ["Nothing awaiting review."]
    : data.awaitingReview.map(
        (r) => `- ${pageLink(orgSlug, r)} - ${r.versionsBehind} version${r.versionsBehind === 1 ? "" : "s"} behind trusted`
      );

  const hotSpotLines = data.hotSpots.length === 0
    ? ["No hot spots this window."]
    : data.hotSpots.map((h) => `- ${pageLink(orgSlug, h)} - ${h.versionCount} edits`);

  const json = {
    title,
    shell: "document",
    pageType: "digest",
    components: [
      { type: "section", heading: "Overview", components: [{ type: "markdown", body: overviewLines.join("\n") }] },
      { type: "section", heading: "New pages", components: [{ type: "markdown", body: newPagesLines.join("\n").trim() }] },
      { type: "section", heading: "Trust flips", components: [{ type: "markdown", body: trustFlipLines.join("\n") }] },
      { type: "section", heading: "Awaiting review", components: [{ type: "markdown", body: awaitingReviewLines.join("\n") }] },
      { type: "section", heading: "Hot spots", components: [{ type: "markdown", body: hotSpotLines.join("\n") }] },
    ],
  };

  return yaml.dump(json, { lineWidth: -1, noRefs: true });
}
