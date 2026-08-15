import yaml from "js-yaml";
import { createHash } from "crypto";
import { db } from "./db";
import type { Prisma } from "@/generated/prisma/client";
import { ensureComponentIds } from "./component-ids";
import { hasDashboardBlock, contextHeader } from "./glance-prompts";
import type { GlanceContext } from "./glance-prompts";
import { listPagesWhere, defaultPageVisibility } from "./access";
import { logAudit } from "./audit";

/// npm dist-tag style read channel: "latest" is the current behavior (newest
/// version); "trusted" resolves to the version a human pinned via
/// markTrusted, falling back to latest (labeled untrusted) when nothing has
/// been marked yet. Every function below defaults to "latest" so existing
/// callers (web UI, export, public pages) are byte-identical unless they
/// opt in — only the MCP surface defaults its own calls to "trusted".
export type Channel = "trusted" | "latest";

export interface ChannelLabel {
  /** Is the served content the trusted version? */
  trusted: boolean;
  /** Is there a trusted pointer that the latest version has moved past? */
  trustedBehind: boolean;
}

/// Given a page's trust pointer and its latest version id, decide which
/// version id should be served for the requested channel and how to label
/// the result. Shared by every read path so the trust semantics can't drift
/// between read_page / list_pages / search_pages or the two MCP transports.
function resolveChannel(
  trustedVersionId: string | null,
  latestVersionId: string,
  channel: Channel
): { versionId: string; label: ChannelLabel } {
  const hasTrusted = !!trustedVersionId;
  const trustedIsLatest = hasTrusted && trustedVersionId === latestVersionId;
  const trustedBehind = hasTrusted && !trustedIsLatest;

  if (channel === "trusted" && hasTrusted) {
    return { versionId: trustedVersionId as string, label: { trusted: true, trustedBehind } };
  }
  // "latest" channel, or "trusted" requested with nothing marked yet — serve
  // latest either way, but only label it trusted if it happens to be the
  // pinned version.
  return { versionId: latestVersionId, label: { trusted: trustedIsLatest, trustedBehind } };
}

export interface PageMeta {
  slug: string;
  title: string;
  annotationCount: number;
  pendingAnnotationCount: number;
  viewCount: number;
  updatedAt: Date;
  lastActivity: Date;
  lastEditedBy: string;
  folderId: string | null;
  visibility: string;
  snippet: string;
  createdBy: string;
  sortOrder: number | null;
  pinned: boolean;
  status: string;
  freshness: "fresh" | "due" | "overdue" | null;
  staleReason: string | null;
  trusted: boolean;
  trustedBehind: boolean;
}

/// Bump view stats without touching updatedAt. Prisma's @updatedAt fires on
/// every update, so a normal increment would make "recently updated" mean
/// "recently looked at" — raw SQL keeps the content clock honest.
export async function bumpViewCount(pageId: string): Promise<void> {
  await db.$executeRaw`UPDATE pages SET view_count = view_count + 1, last_viewed_at = now() WHERE id = ${pageId}`;
}

export interface AnnotationRow {
  id: string;
  text: string;
  author: string;
  section: string | null;
  target: string | null;
  kind: string;
  replacement: string | null;
  status: string;
  source: string;
  slide: string | null;
  visibility: string | null;
  createdAt: Date;
}

export async function listPages(
  orgId: string,
  userId?: string,
  channel: Channel = "latest"
): Promise<PageMeta[]> {
  const where = listPagesWhere(orgId, userId ?? null);

  const pages = await db.page.findMany({
    where,
    include: {
      _count: {
        select: {
          annotations: true,
          // Pending = anything a human hasn't dispositioned yet.
        },
      },
      annotations: {
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, status: true },
      },
      versions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, jsonContent: true, createdBy: true },
      },
    },
    orderBy: [
      { sortOrder: { sort: "asc", nulls: "last" } },
      { title: "asc" },
    ],
  });

  // Batch-resolve the trusted version's content for any page whose trust
  // pointer has fallen behind latest — avoids an N+1 query per page.
  const overrideIds = channel === "trusted"
    ? pages
        .filter((p) => p.trustedVersionId && p.versions[0] && p.trustedVersionId !== p.versions[0].id)
        .map((p) => p.trustedVersionId as string)
    : [];
  const overrides = overrideIds.length > 0
    ? await db.pageVersion.findMany({
        where: { id: { in: overrideIds } },
        select: { id: true, pageId: true, jsonContent: true, createdBy: true },
      })
    : [];
  const overrideByPageId = new Map(overrides.map((v) => [v.pageId, v]));

  const mapped = pages.map((p) => {
    const latestAnnotation = p.annotations[0]?.createdAt;
    const lastActivity = latestAnnotation && latestAnnotation > p.updatedAt
      ? latestAnnotation
      : p.updatedAt;
    const pendingAnnotationCount = p.annotations.filter(
      (a) => a.status !== "incorporated" && a.status !== "ignored"
    ).length;

    const latestVersion = p.versions[0];
    const override = overrideByPageId.get(p.id);
    const servedVersion = override ?? latestVersion;

    let snippet = p.title;
    if (servedVersion?.jsonContent) {
      const json = servedVersion.jsonContent as Record<string, unknown>;
      const raw = (json.subtitle as string) || (json.description as string) || "";
      if (raw) {
        snippet = raw.length > 120 ? raw.slice(0, 117) + "..." : raw;
      }
    }

    const [freshness, staleReason] = staleness(
      servedVersion?.jsonContent as Record<string, unknown> | null,
      p.updatedAt,
      p.lastViewedAt
    );

    const { label } = resolveChannel(p.trustedVersionId, latestVersion?.id ?? "", channel);

    return {
      slug: p.slug,
      title: p.title,
      annotationCount: p._count.annotations,
      pendingAnnotationCount,
      viewCount: p.viewCount,
      updatedAt: p.updatedAt,
      lastActivity,
      lastEditedBy: servedVersion?.createdBy ?? p.createdBy,
      folderId: p.folderId,
      visibility: p.visibility,
      snippet,
      createdBy: p.createdBy,
      sortOrder: p.sortOrder,
      pinned: p.pinned,
      status: p.status,
      freshness,
      staleReason,
      trusted: label.trusted,
      trustedBehind: label.trustedBehind,
    };
  });

  return mapped;
}

/// True when the page content contains a task tree with unfinished nodes —
/// the signal that a "plan" page claims ongoing work.
function hasOpenTasks(json: Record<string, unknown> | null): boolean {
  if (!json) return false;
  let open = false;
  function walkNodes(nodes: unknown) {
    if (!Array.isArray(nodes) || open) return;
    for (const n of nodes as Record<string, unknown>[]) {
      const st = (n.status as string) ?? "default";
      if (st !== "completed") {
        open = true;
        return;
      }
      walkNodes(n.children);
    }
  }
  function walkComponents(comps: unknown) {
    if (!Array.isArray(comps) || open) return;
    for (const c of comps as Record<string, unknown>[]) {
      if (c.type === "tree") walkNodes(c.nodes);
      walkComponents(c.components);
      if (Array.isArray(c.tabs)) {
        for (const t of c.tabs as Record<string, unknown>[]) walkComponents(t.components);
      }
    }
  }
  walkComponents(json.components);
  return open;
}

const DAY_MS = 86400000;

/// Staleness signal: explicit freshness metadata wins; otherwise cheap
/// passive heuristics. Returns [state, human-readable reason]. These are
/// hints for the dashboard and seed data for the cleanup audit — they never
/// auto-flag anything.
function staleness(
  json: Record<string, unknown> | null,
  updatedAt: Date,
  lastViewedAt: Date | null
): ["fresh" | "due" | "overdue" | null, string | null] {
  const explicit = freshnessStatus(json, updatedAt);
  if (explicit) {
    return [
      explicit,
      explicit === "fresh" ? null : "past its review cadence",
    ];
  }
  const contentAgeDays = (Date.now() - updatedAt.getTime()) / DAY_MS;
  if (contentAgeDays > 60 && hasOpenTasks(json)) {
    return ["overdue", "open tasks but no content change in 60+ days"];
  }
  // Only trust the view signal once we have one — lastViewedAt ships null
  // for every page that predates the column.
  if (lastViewedAt && (Date.now() - lastViewedAt.getTime()) / DAY_MS > 60) {
    return ["due", "no views in 60+ days"];
  }
  return [null, null];
}

/// Freshness from the page's kazam metadata when present: `freshness.review_every`
/// (weekly/monthly/quarterly/yearly or Nd/Nw/Nm/Ny) measured against the page's
/// last content update. Pages without freshness metadata return null — no badge.
function freshnessStatus(
  json: Record<string, unknown> | null,
  updatedAt: Date
): "fresh" | "due" | "overdue" | null {
  const f = json?.freshness as Record<string, unknown> | undefined;
  if (!f || typeof f !== "object") return null;
  const cadence = f.review_every as string | undefined;
  if (!cadence) return null;

  const cadenceMap: Record<string, number> = {
    weekly: 7, monthly: 30, quarterly: 90, yearly: 365, annually: 365,
  };
  let days = cadenceMap[cadence];
  if (!days) {
    const m = cadence.match(/^(\d+)(d|w|m|y)$/);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    days = m[2] === "d" ? n : m[2] === "w" ? n * 7 : m[2] === "m" ? n * 30 : n * 365;
  }

  const base = typeof f.updated === "string" ? new Date(f.updated) : updatedAt;
  const elapsed = (Date.now() - base.getTime()) / 86400000;
  if (elapsed > days) return "overdue";
  if (elapsed > days * 0.8) return "due";
  return "fresh";
}

export async function readPageYaml(
  orgId: string,
  slug: string,
  channel: Channel = "latest"
): Promise<{ yaml: string; contentHash: string } & ChannelLabel | null> {
  const page = await db.page.findUnique({
    where: { orgId_slug: { orgId, slug } },
    include: {
      versions: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  if (!page || page.versions.length === 0) return null;

  const latest = page.versions[0];
  const { versionId, label } = resolveChannel(page.trustedVersionId, latest.id, channel);

  let v = latest;
  if (versionId !== latest.id) {
    const trustedRow = await db.pageVersion.findUnique({ where: { id: versionId } });
    if (trustedRow) {
      v = trustedRow;
    } else {
      v = latest;
      label.trusted = false;
    }
  }

  return { yaml: v.yamlContent, contentHash: v.contentHash, ...label };
}

export async function readPage(
  orgId: string,
  slug: string,
  channel: Channel = "latest"
): Promise<{ json: Record<string, unknown>; contentHash: string; visibility: string; pageId: string; createdBy: string } & ChannelLabel | null> {
  const page = await db.page.findUnique({
    where: { orgId_slug: { orgId, slug } },
    include: {
      versions: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  if (!page || page.versions.length === 0) return null;

  const latest = page.versions[0];
  const { versionId, label } = resolveChannel(page.trustedVersionId, latest.id, channel);

  let v = latest;
  if (versionId !== latest.id) {
    const trustedRow = await db.pageVersion.findUnique({ where: { id: versionId } });
    if (trustedRow) {
      v = trustedRow;
    } else {
      // Dangling pointer (trusted version row is gone) — fall back to latest,
      // and the served content is not actually the trusted one.
      v = latest;
      label.trusted = false;
    }
  }

  const json = v.jsonContent
    ? (v.jsonContent as Record<string, unknown>)
    : (yaml.load(v.yamlContent) as Record<string, unknown>);
  // pageId/createdBy ride along so callers (component-refs.ts's ref
  // expansion) can run resolvePageAccess against the *referenced* page
  // without a second round-trip query.
  return { json, contentHash: v.contentHash, visibility: page.visibility, pageId: page.id, createdBy: page.createdBy, ...label };
}

export interface SearchResult {
  slug: string;
  title: string;
  matches: string[];
  type: "page" | "prompt";
  prompt?: string;
  trusted?: boolean;
  trustedBehind?: boolean;
}

export interface SearchIndexEntry {
  slug: string;
  title: string;
  /** Raw YAML content of the served version (respects the requested channel). */
  content: string;
  json: Record<string, unknown> | null;
  dashboardEnabled: boolean;
  label: ChannelLabel;
}

/**
 * Loads every page in `orgId` this caller can see, resolved to whichever
 * version the requested channel should serve — one DB round trip (plus, for
 * "trusted", a second batch fetch of trusted-pointer overrides) regardless of
 * how many queries the caller then runs against it in memory.
 *
 * Factored out of searchPages so callers that need to run several queries
 * against the same org (capture-dedup's phrase/term passes) can fetch this
 * once instead of once per query — the trust-channel resolution here is
 * byte-identical to what searchPages does inline.
 */
export async function loadSearchIndex(
  orgId: string,
  userId?: string,
  channel: Channel = "latest"
): Promise<SearchIndexEntry[]> {
  const where = listPagesWhere(orgId, userId ?? null);

  const pages = await db.page.findMany({
    where,
    select: {
      id: true,
      slug: true,
      title: true,
      dashboardEnabled: true,
      trustedVersionId: true,
      versions: { orderBy: { createdAt: "desc" as const }, take: 1, select: { id: true, yamlContent: true, jsonContent: true } },
    },
  });

  // Batch-resolve trusted-channel overrides the same way listPages does.
  const overrideIds = channel === "trusted"
    ? pages
        .filter((p) => p.trustedVersionId && p.versions[0] && p.trustedVersionId !== p.versions[0].id)
        .map((p) => p.trustedVersionId as string)
    : [];
  const overrides = overrideIds.length > 0
    ? await db.pageVersion.findMany({
        where: { id: { in: overrideIds } },
        select: { id: true, pageId: true, yamlContent: true, jsonContent: true },
      })
    : [];
  const overrideByPageId = new Map(overrides.map((v) => [v.pageId, v]));

  const entries: SearchIndexEntry[] = [];
  for (const page of pages) {
    if (page.versions.length === 0) continue;
    const latestV = page.versions[0];
    const override = overrideByPageId.get(page.id);
    const servedV = override ?? latestV;
    const { label } = resolveChannel(page.trustedVersionId, latestV.id, channel);
    entries.push({
      slug: page.slug,
      title: page.title,
      content: servedV.yamlContent,
      json: servedV.jsonContent as Record<string, unknown> | null,
      dashboardEnabled: page.dashboardEnabled,
      label,
    });
  }
  return entries;
}

export async function searchPages(
  orgId: string,
  query: string,
  userId?: string,
  glanceCtx: GlanceContext = {},
  channel: Channel = "latest"
): Promise<SearchResult[]> {
  const entries = await loadSearchIndex(orgId, userId, channel);

  const q = query.toLowerCase();
  const results: SearchResult[] = [];

  for (const entry of entries) {
    const content = entry.content;
    const json = entry.json;
    const label = entry.label;

    const titleMatch = entry.title.toLowerCase().includes(q);
    const contentMatch = content.toLowerCase().includes(q);
    if (!titleMatch && !contentMatch) continue;

    const lines = content.split("\n");
    const matches = lines
      .filter((l) => l.toLowerCase().includes(q))
      .slice(0, 5)
      .map((l) => l.trim());

    const isDashboard = entry.dashboardEnabled && json && hasDashboardBlock(json);
    const dashBlock = isDashboard ? (json!.dashboard as { prompt: string; title?: string; description?: string }) : null;

    const rawPrompt = dashBlock?.prompt;
    const wrappedPrompt = rawPrompt
      ? `${contextHeader(glanceCtx)}\n\nWorkflow page: read_page("${entry.slug}") for full steps.\n\n${rawPrompt.trim()}`
      : undefined;

    results.push({
      slug: entry.slug,
      title: dashBlock?.title ?? entry.title,
      matches: titleMatch && matches.length === 0 ? [dashBlock?.description ?? entry.title] : matches,
      type: isDashboard ? "prompt" : "page",
      prompt: wrappedPrompt,
      trusted: label.trusted,
      trustedBehind: label.trustedBehind,
    });

    if (entry.slug === "home" && json) {
      const prompts = json.prompts as Array<{ title: string; prompt: string; description?: string }> | undefined;
      if (Array.isArray(prompts)) {
        for (const p of prompts) {
          if (!p?.title || !p?.prompt) continue;
          const pMatch = p.title.toLowerCase().includes(q) ||
            (p.description ?? "").toLowerCase().includes(q) ||
            p.prompt.toLowerCase().includes(q);
          if (!pMatch) continue;
          results.push({
            slug: "home",
            title: p.title,
            matches: [p.description ?? "Custom prompt"],
            type: "prompt",
            prompt: `${contextHeader(glanceCtx)}\n\n${p.prompt.trim()}`,
            trusted: label.trusted,
            trustedBehind: label.trustedBehind,
          });
        }
      }
    }
  }

  return results;
}


async function _writePageInternal(
  orgId: string,
  orgSlug: string,
  slug: string,
  yamlContent: string,
  jsonContent: Prisma.InputJsonValue | undefined,
  title: string,
  createdBy: string,
  expectedHash?: string,
  sortOrder?: number | null,
  visibility?: string
): Promise<{ ok: true; slug: string; contentHash: string } | { ok: false; error: string }> {
  const contentHash = createHash("sha256").update(yamlContent).digest("hex");
  const dashboardEnabled = jsonContent
    ? hasDashboardBlock(jsonContent as Record<string, unknown>)
    : false;

  const existing = await db.page.findUnique({
    where: { orgId_slug: { orgId, slug } },
    include: {
      versions: { orderBy: { createdAt: "desc" }, take: 1 },
      folder: { select: { locked: true } },
    },
  });

  if (existing?.folder?.locked) {
    return { ok: false, error: "cannot edit: page is in a curata-managed folder (view + copy only)" };
  }

  if (expectedHash && existing && existing.versions.length > 0) {
    if (existing.versions[0].contentHash !== expectedHash) {
      return { ok: false, error: "conflict: page was modified since last read" };
    }
  }

  if (existing) {
    if (existing.versions.length > 0 && existing.versions[0].contentHash === contentHash && sortOrder === undefined) {
      return { ok: true, slug, contentHash };
    }

    const pageUpdateData: Record<string, unknown> = { title, updatedAt: new Date(), dashboardEnabled };
    if (sortOrder !== undefined) pageUpdateData.sortOrder = sortOrder;

    await db.$transaction([
      db.pageVersion.create({
        data: { pageId: existing.id, yamlContent, jsonContent, contentHash, createdBy },
      }),
      db.page.update({
        where: { id: existing.id },
        data: pageUpdateData,
      }),
    ]);
  } else {
    const createData: Record<string, unknown> = {
      orgId,
      slug,
      title,
      createdBy,
      visibility: visibility ?? defaultPageVisibility(),
      dashboardEnabled,
      versions: {
        create: { yamlContent, jsonContent, contentHash, createdBy },
      },
    };
    if (sortOrder !== undefined && sortOrder !== null) createData.sortOrder = sortOrder;

    await db.page.create({ data: createData as Parameters<typeof db.page.create>[0]["data"] });
  }

  return { ok: true, slug, contentHash };
}

export async function writePage(
  orgId: string,
  orgSlug: string,
  slug: string,
  content: string,
  createdBy: string,
  expectedHash?: string,
  sortOrder?: number | null,
  visibility?: string
): Promise<{ ok: true; slug: string; contentHash: string } | { ok: false; error: string }> {
  let jsonContent: Record<string, unknown> | undefined;
  try {
    jsonContent = yaml.load(content) as Record<string, unknown>;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Invalid YAML: ${msg}` };
  }
  let yamlContent = content;

  if (jsonContent && Array.isArray(jsonContent.components)) {
    jsonContent = { ...jsonContent, components: ensureComponentIds(jsonContent.components as Record<string, unknown>[]) };
    yamlContent = yaml.dump(jsonContent, { lineWidth: -1, noRefs: true });
  }

  const title = (jsonContent?.title as string) || extractTitle(content, slug);
  return _writePageInternal(orgId, orgSlug, slug, yamlContent, jsonContent as Prisma.InputJsonValue | undefined, title, createdBy, expectedHash, sortOrder, visibility);
}

export async function writePageJson(
  orgId: string,
  orgSlug: string,
  slug: string,
  json: Record<string, unknown>,
  createdBy: string,
  expectedHash?: string,
  sortOrder?: number | null
): Promise<{ ok: true; slug: string; contentHash: string } | { ok: false; error: string }> {
  let stamped = json;
  if (Array.isArray(json.components)) {
    stamped = { ...json, components: ensureComponentIds(json.components as Record<string, unknown>[]) };
  }
  const yamlContent = yaml.dump(stamped, { lineWidth: -1, noRefs: true });
  const title = (stamped.title as string) || slug;
  return _writePageInternal(orgId, orgSlug, slug, yamlContent, stamped as Prisma.InputJsonValue, title, createdBy, expectedHash, sortOrder);
}

/// Pin a specific PageVersion as the "trusted" read for this page (npm
/// dist-tag style). Never touches the write path — trustedVersionId only
/// moves here and in clearTrusted.
export async function markTrusted(
  orgId: string,
  slug: string,
  versionId: string,
  actorId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const page = await db.page.findUnique({ where: { orgId_slug: { orgId, slug } } });
  if (!page) return { ok: false, error: `page not found: ${slug}` };

  const version = await db.pageVersion.findFirst({ where: { id: versionId, pageId: page.id } });
  if (!version) return { ok: false, error: `version not found: ${versionId}` };

  await db.page.update({ where: { id: page.id }, data: { trustedVersionId: versionId } });

  await logAudit({
    orgId,
    action: "page.trust",
    resourceType: "page",
    resourceId: slug,
    actorId,
    metadata: { versionId, contentHash: version.contentHash },
  });

  return { ok: true };
}

/// Clear a page's trust pointer — reads on the "trusted" channel fall back
/// to latest, labeled untrusted, until a human marks a version again.
export async function clearTrusted(
  orgId: string,
  slug: string,
  actorId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const page = await db.page.findUnique({ where: { orgId_slug: { orgId, slug } } });
  if (!page) return { ok: false, error: `page not found: ${slug}` };

  const previousVersionId = page.trustedVersionId;
  await db.page.update({ where: { id: page.id }, data: { trustedVersionId: null } });

  await logAudit({
    orgId,
    action: "page.untrust",
    resourceType: "page",
    resourceId: slug,
    actorId,
    metadata: { previousVersionId },
  });

  return { ok: true };
}

export interface ReviewQueueRow {
  slug: string;
  title: string;
  folderId: string | null;
  folderName: string | null;
  createdBy: string;
  latestEditedBy: string;
  latestUpdatedAt: Date;
  /** True when this page has never had a trusted version marked. */
  neverTrusted: boolean;
  /** How many versions have landed since the trusted pointer (or since creation, if never trusted). */
  versionsBehind: number;
  /** createdAt of the oldest version not yet covered by trust — drives staleness sort. */
  sinceUnapprovedAt: Date;
  concepts: string[];
  createdByMe: boolean;
  annotatedByMe: boolean;
}

interface ReviewCandidate {
  pageId: string;
  slug: string;
  title: string;
  folderId: string | null;
  createdBy: string;
  latestVersionId: string;
  trustedVersionId: string | null;
  neverTrusted: boolean;
}

/// Cheap first pass: which pages qualify for the review queue (never trusted,
/// or trusted pointer behind the latest version)? Mirrors the batching
/// pattern in listPages — take:1 on versions avoids pulling full history for
/// pages that don't qualify.
async function getReviewCandidates(
  orgId: string,
  userId?: string
): Promise<ReviewCandidate[]> {
  const where = listPagesWhere(orgId, userId ?? null);
  const pages = await db.page.findMany({
    where,
    select: {
      id: true,
      slug: true,
      title: true,
      folderId: true,
      createdBy: true,
      trustedVersionId: true,
      versions: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true } },
    },
  });

  const candidates: ReviewCandidate[] = [];
  for (const p of pages) {
    const latest = p.versions[0];
    if (!latest) continue;
    const neverTrusted = !p.trustedVersionId;
    if (!neverTrusted && p.trustedVersionId === latest.id) continue;

    candidates.push({
      pageId: p.id,
      slug: p.slug,
      title: p.title,
      folderId: p.folderId,
      createdBy: p.createdBy,
      latestVersionId: latest.id,
      trustedVersionId: p.trustedVersionId,
      neverTrusted,
    });
  }
  return candidates;
}

/// Count of pages awaiting review — powers the sidebar nav badge without
/// paying for the full enrichment (concepts, annotation authors) the queue
/// view needs.
export async function getReviewQueueCount(orgId: string, userId?: string): Promise<number> {
  const candidates = await getReviewCandidates(orgId, userId);
  return candidates.length;
}

/// Pages needing review: never trusted, or the trusted pointer has fallen
/// behind the latest version. Sorted oldest-unapproved-change first — the
/// page that's been waiting longest for a human look surfaces at the top.
/// Purely a read over existing data: no new state, no write-path changes.
export async function getReviewQueue(orgId: string, userId?: string): Promise<ReviewQueueRow[]> {
  const candidates = await getReviewCandidates(orgId, userId);
  if (candidates.length === 0) return [];

  const pageIds = candidates.map((c) => c.pageId);

  const [folders, versions, concepts, annotations] = await Promise.all([
    db.folder.findMany({ where: { orgId }, select: { id: true, name: true } }),
    db.pageVersion.findMany({
      where: { pageId: { in: pageIds } },
      orderBy: { createdAt: "asc" },
      select: { pageId: true, id: true, createdAt: true, createdBy: true },
    }),
    db.pageConcept.findMany({
      where: { pageId: { in: pageIds } },
      select: { pageId: true, concept: { select: { displayName: true } } },
    }),
    db.annotation.findMany({
      where: { pageId: { in: pageIds } },
      select: { pageId: true, author: true },
    }),
  ]);

  const folderNameById = new Map(folders.map((f) => [f.id, f.name]));

  const versionsByPage = new Map<string, typeof versions>();
  for (const v of versions) {
    const list = versionsByPage.get(v.pageId) ?? [];
    list.push(v);
    versionsByPage.set(v.pageId, list);
  }

  const conceptsByPage = new Map<string, string[]>();
  for (const c of concepts) {
    const list = conceptsByPage.get(c.pageId) ?? [];
    list.push(c.concept.displayName);
    conceptsByPage.set(c.pageId, list);
  }

  const annotationAuthorsByPage = new Map<string, string[]>();
  for (const a of annotations) {
    const list = annotationAuthorsByPage.get(a.pageId) ?? [];
    list.push(a.author);
    annotationAuthorsByPage.set(a.pageId, list);
  }

  const rows: ReviewQueueRow[] = [];
  for (const c of candidates) {
    const pageVersions = versionsByPage.get(c.pageId) ?? [];
    if (pageVersions.length === 0) continue;
    const latest = pageVersions[pageVersions.length - 1];

    // Never trusted: every version is unreviewed. Otherwise, only the
    // versions created after the trusted one are "behind" — anything before
    // it was already superseded by a version a human did look at.
    let unapproved = pageVersions;
    if (!c.neverTrusted) {
      const trustedIdx = pageVersions.findIndex((v) => v.id === c.trustedVersionId);
      unapproved = trustedIdx === -1 ? pageVersions : pageVersions.slice(trustedIdx + 1);
      if (unapproved.length === 0) continue; // dangling pointer already at latest — nothing to review
    }

    rows.push({
      slug: c.slug,
      title: c.title,
      folderId: c.folderId,
      folderName: c.folderId ? folderNameById.get(c.folderId) ?? null : null,
      createdBy: c.createdBy,
      latestEditedBy: latest.createdBy,
      latestUpdatedAt: latest.createdAt,
      neverTrusted: c.neverTrusted,
      versionsBehind: unapproved.length,
      sinceUnapprovedAt: unapproved[0].createdAt,
      concepts: conceptsByPage.get(c.pageId) ?? [],
      createdByMe: !!userId && c.createdBy === userId,
      annotatedByMe: !!userId && (annotationAuthorsByPage.get(c.pageId) ?? []).includes(userId),
    });
  }

  rows.sort((a, b) => a.sinceUnapprovedAt.getTime() - b.sinceUnapprovedAt.getTime());
  return rows;
}

export async function saveAnnotation(
  orgId: string,
  orgSlug: string,
  slug: string,
  text: string,
  author: string,
  section?: string,
  target?: string,
  kind?: "note" | "edit" | "talking_point",
  replacement?: string,
  source: "web" | "agent" | "cli" = "web",
  slide?: string,
  visibility?: "visible" | "presenter",
): Promise<AnnotationRow> {
  const page = await db.page.findUnique({
    where: { orgId_slug: { orgId, slug } },
  });

  if (!page) throw new Error(`page not found: ${slug}`);

  const ann = await db.annotation.create({
    data: {
      pageId: page.id,
      text,
      author,
      section: section ?? null,
      target: target ?? null,
      kind: kind ?? "note",
      replacement: replacement ?? null,
      source,
      slide: slide ?? null,
      visibility: visibility ?? null,
    },
  });

  return ann;
}

export async function updateAnnotationStatus(
  orgId: string,
  orgSlug: string,
  slug: string,
  annotationId: string,
  status: "approved" | "incorporated" | "ignored"
): Promise<boolean> {
  const page = await db.page.findUnique({
    where: { orgId_slug: { orgId, slug } },
  });

  if (!page) return false;

  const ann = await db.annotation.findFirst({
    where: { id: annotationId, pageId: page.id },
  });

  if (!ann) return false;

  await db.annotation.update({
    where: { id: annotationId },
    data: { status },
  });

  return true;
}

export async function getAnnotations(
  orgId: string,
  slug: string
): Promise<AnnotationRow[]> {
  const page = await db.page.findUnique({
    where: { orgId_slug: { orgId, slug } },
    include: {
      annotations: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!page) return [];
  return page.annotations;
}

export async function getPageSections(
  orgId: string,
  slug: string,
  channel: Channel = "latest"
): Promise<string[]> {
  const result = await readPageYaml(orgId, slug, channel);
  if (!result) return [];

  const doc = yaml.load(result.yaml) as Record<string, unknown>;
  const components = doc.components as Array<Record<string, unknown>> | undefined;
  if (!components) return [];

  return components
    .filter((c) => c.type === "section" && typeof c.heading === "string")
    .map((c) => c.heading as string);
}

export async function getSiteConfig(orgId: string): Promise<Record<string, unknown> | null> {
  const org = await db.organization.findFirst({ where: { id: orgId } });
  if (!org) return null;
  const config: Record<string, unknown> = { name: org.name };
  if (org.theme && org.theme !== "dark") config.theme = org.theme;
  if (org.mode && org.mode !== "dark") config.mode = org.mode;
  if (org.texture && org.texture !== "none") config.texture = org.texture;
  if (org.glow && org.glow !== "none") config.glow = org.glow;
  if (org.rules) config.rules = org.rules;
  return config;
}

function extractTitle(yamlContent: string, fallback: string): string {
  try {
    const doc = yaml.load(yamlContent) as Record<string, unknown>;
    return (doc.title as string) || fallback;
  } catch {
    return fallback;
  }
}

export function daysAgo(dateStr: string): number {
  const d = new Date(dateStr);
  const now = new Date();
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}
