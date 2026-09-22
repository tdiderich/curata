import { db } from "./db";
import yaml from "js-yaml";
import { readPageYaml, writePage } from "./pages";
import { findConceptForTerm, normalizeTerm, UNREACHABLE_PREFIX } from "./concepts";

/**
 * The content map. Nodes are concepts with fan-out: a template
 * (instances under it), a component page (pages embedding it), a source page
 * (pages that depend on the concept it asserts), or anything someone
 * promoted. Children are the edges under the node, each with one color:
 *
 *   green   source unchanged since last check, or checked after it moved,
 *           or nothing to drift against
 *   yellow  source moved since last check, or never checked
 *   red     someone looked and it's wrong (mismatch note), or yellow plus
 *           past due, or the source moved twice since the last check (or
 *           since the edge was added, when it was never checked)
 *
 * Node color is the worst child. Nobody draws this; the write path did.
 */

export type ChartColor = "green" | "yellow" | "red";
export const NODE_FANOUT_THRESHOLD = 3;

/** Rels that put a page under a node. `asserts` is the node's own source, not a child. */
export const CHILD_RELS = ["depends", "embeds", "instantiates"] as const;

export interface ChartChild {
  kind: "page" | "external";
  /** PageConcept id or ExternalEdge id. What `checked` targets. */
  edgeId: string;
  label: string;
  slug: string | null;
  url: string | null;
  host: string | null;
  rel: string;
  color: ChartColor;
  /** Why red/yellow, one short phrase for the UI. */
  reason: string | null;
  lastCheckedAt: string | null;
  note: string | null;
  owner: string | null;
  dueAt: string | null;
  /** Other chart nodes this same page or asset sits under. */
  alsoUnder: string[];
  /** Check recipe on the asset, when one exists. External only. */
  check: unknown | null;
}

export interface ChartSource {
  slug: string;
  title: string;
  updatedAt: string;
  updatedBy: string | null;
  /** The source page's meta Status field, if it has one ("Planned", "Shipped"...). */
  status: string | null;
}

/**
 * Which tab a node lives on. A source page with a meta Status is a piece of
 * work: active until the status reads finished, then completed. No status
 * means a standing watch (templates, components, topics).
 */
export type ChartGroup = "active" | "watching" | "completed";
export const CHART_GROUPS: ChartGroup[] = ["active", "watching", "completed"];
const DONE_STATUS = /\b(shipped|done|complete|completed|closed|launched|released|archived)\b/i;

export function groupFor(status: string | null): ChartGroup {
  if (!status || !status.trim()) return "watching";
  return DONE_STATUS.test(status) ? "completed" : "active";
}

/** The Status value from a page's meta component, or null. Case-insensitive on the key. */
export function statusFromYaml(yamlText: string | null | undefined): string | null {
  if (!yamlText) return null;
  let doc: unknown;
  try { doc = yaml.load(yamlText); } catch { return null; }
  const walk = (nodes: unknown): string | null => {
    if (!Array.isArray(nodes)) return null;
    for (const n of nodes) {
      if (!n || typeof n !== "object") continue;
      const c = n as { type?: string; fields?: Array<{ key?: string; value?: unknown }>; components?: unknown };
      if (c.type === "meta" && Array.isArray(c.fields)) {
        const f = c.fields.find((x) => typeof x?.key === "string" && x.key.trim().toLowerCase() === "status");
        if (f && f.value !== undefined && f.value !== null) return String(f.value).trim() || null;
      }
      const inner = walk(c.components);
      if (inner) return inner;
    }
    return null;
  };
  return walk((doc as { components?: unknown } | null)?.components);
}

export interface ChartNode {
  term: string;
  kind: string;
  title: string;
  source: ChartSource | null;
  fanOut: number;
  color: ChartColor;
  counts: Record<ChartColor, number>;
  hidden: boolean;
  promoted: boolean;
  /** Per-node note for agents, appended to copied prompts. */
  instructions: string | null;
  group: ChartGroup;
}

export interface ChartNodeDetail extends ChartNode {
  children: ChartChild[];
}

export interface Chart {
  nodes: ChartNode[];
  totals: Record<ChartColor, number>;
}

const WORST: ChartColor[] = ["red", "yellow", "green"];
function worst(a: ChartColor, b: ChartColor): ChartColor {
  return WORST.indexOf(a) <= WORST.indexOf(b) ? a : b;
}

function hostOf(url: string): string | null {
  try { return new URL(url).host.replace(/^www\./, ""); } catch { return null; }
}

interface SourceRow { pageId: string; slug: string; title: string; updatedAt: Date; updatedBy: string | null; status: string | null }

/** Source page per concept: the asserter, else the page named by a template/ or component/ term. */
async function resolveSources(orgId: string, concepts: Array<{ id: string; normalizedName: string }>): Promise<Map<string, SourceRow>> {
  const out = new Map<string, SourceRow>();
  if (concepts.length === 0) return out;
  const ids = concepts.map((c) => c.id);
  const asserts = await db.pageConcept.findMany({
    where: { conceptId: { in: ids }, rel: "asserts", page: { orgId, status: { not: "archived" } } },
    select: { conceptId: true, page: { select: { id: true, slug: true, title: true, updatedAt: true, versions: { orderBy: { createdAt: "desc" }, take: 1, select: { createdBy: true, yamlContent: true } } } } },
  });
  for (const r of asserts) {
    const cur = out.get(r.conceptId);
    if (!cur || r.page.updatedAt > cur.updatedAt) {
      out.set(r.conceptId, { pageId: r.page.id, slug: r.page.slug, title: r.page.title, updatedAt: r.page.updatedAt, updatedBy: r.page.versions[0]?.createdBy ?? null, status: statusFromYaml(r.page.versions[0]?.yamlContent) });
    }
  }
  const bySlug = new Map<string, string[]>();
  for (const c of concepts) {
    if (out.has(c.id)) continue;
    const m = /^(template|component)\/(.+)$/.exec(c.normalizedName);
    if (!m) continue;
    bySlug.set(m[2], [...(bySlug.get(m[2]) ?? []), c.id]);
  }
  if (bySlug.size > 0) {
    const pages = await db.page.findMany({
      where: { orgId, slug: { in: [...bySlug.keys()] }, status: { not: "archived" } },
      select: { id: true, slug: true, title: true, updatedAt: true, versions: { orderBy: { createdAt: "desc" }, take: 1, select: { createdBy: true, yamlContent: true } } },
    });
    for (const pg of pages) for (const id of bySlug.get(pg.slug) ?? []) {
      out.set(id, { pageId: pg.id, slug: pg.slug, title: pg.title, updatedAt: pg.updatedAt, updatedBy: pg.versions[0]?.createdBy ?? null, status: statusFromYaml(pg.versions[0]?.yamlContent) });
    }
  }
  return out;
}

function colorFor(
  verifiedAt: Date | null,
  edgeCreatedAt: Date,
  needsChange: boolean,
  note: string | null,
  dueAt: Date | null,
  source: SourceRow | undefined,
  sourceVersions: Array<{ at: Date; hash: string }>,
  now: Date
): { color: ChartColor; reason: string | null } {
  // Someone looked and it's wrong. That outranks "nobody looked".
  if (needsChange) return { color: "red", reason: note ? `mismatch: ${note}` : "mismatch found" };
  if (!source) return { color: "green", reason: null };
  const stale = !verifiedAt || verifiedAt < source.updatedAt;
  if (!stale) return { color: "green", reason: null };
  // Someone tried and couldn't look: stays yellow, never escalates to red on moves, says why.
  if (note?.startsWith(UNREACHABLE_PREFIX)) {
    const why = note.slice(UNREACHABLE_PREFIX.length).trim();
    return { color: dueAt !== null && dueAt < now ? "red" : "yellow", reason: `couldn't check${why ? ` · ${why}` : ""}` };
  }
  // A never-checked edge only counts source moves it lived through.
  const since = verifiedAt ?? edgeCreatedAt;
  // A "move" is a content change, not a version row: an edit that is then
  // reverted counts once, and a re-save of identical content counts zero.
  const atSince = [...sourceVersions].reverse().find((v) => v.at <= since)?.hash ?? null;
  let moves = 0;
  let last = atSince;
  for (const v of sourceVersions) {
    if (v.at <= since) continue;
    if (v.hash !== last) moves++;
    last = v.hash;
  }
  // Back to the content that was checked: nothing to look at.
  if (last === atSince) moves = 0;
  if (moves === 0 && verifiedAt) return { color: "green", reason: null };
  if (dueAt !== null && dueAt < now) return { color: "red", reason: "past due" };
  if (moves >= 2) return { color: "red", reason: `source moved ${moves} times, no check` };
  return { color: "yellow", reason: verifiedAt ? "not checked since the change" : "never checked" };
}

interface BuildOpts { conceptId?: string; includeHidden?: boolean; allFanOut?: boolean }

async function build(orgId: string, opts: BuildOpts): Promise<ChartNodeDetail[]> {
  const now = new Date();
  const conceptFilter = opts.conceptId ? { conceptId: opts.conceptId } : {};
  const [pageEdges, extEdges, settings] = await Promise.all([
    db.pageConcept.findMany({
      where: { ...conceptFilter, rel: { in: [...CHILD_RELS] }, page: { orgId, status: { not: "archived" } } },
      select: {
        id: true, conceptId: true, rel: true, verifiedAt: true, verifiedNote: true, needsChange: true, createdAt: true,
        page: { select: { id: true, slug: true, title: true } },
        concept: { select: { id: true, normalizedName: true, displayName: true, kind: true } },
      },
    }),
    db.externalEdge.findMany({
      where: { ...conceptFilter, asset: { orgId } },
      select: {
        id: true, conceptId: true, rel: true, verifiedAt: true, verifiedNote: true, needsChange: true, dueAt: true, createdAt: true,
        asset: { select: { id: true, url: true, label: true, owner: true, check: true } },
        concept: { select: { id: true, normalizedName: true, displayName: true, kind: true } },
      },
    }),
    db.chartNodeSetting.findMany({ where: { orgId, ...conceptFilter } }),
  ]);

  const settingBy = new Map(settings.map((s) => [s.conceptId, s]));
  const concepts = new Map<string, { id: string; normalizedName: string; displayName: string; kind: string }>();
  for (const e of pageEdges) concepts.set(e.conceptId, e.concept);
  for (const e of extEdges) concepts.set(e.conceptId, e.concept);
  // A promoted concept is a node even before anything sits under it.
  const wanted = [
    ...(opts.conceptId ? [opts.conceptId] : []),
    ...settings.filter((s) => s.promoted).map((s) => s.conceptId),
  ].filter((id) => !concepts.has(id));
  if (wanted.length > 0) {
    const rows = await db.concept.findMany({ where: { id: { in: wanted } }, select: { id: true, normalizedName: true, displayName: true, kind: true } });
    for (const c of rows) concepts.set(c.id, c);
  }

  const fanOut = new Map<string, number>();
  for (const e of pageEdges) fanOut.set(e.conceptId, (fanOut.get(e.conceptId) ?? 0) + 1);
  for (const e of extEdges) fanOut.set(e.conceptId, (fanOut.get(e.conceptId) ?? 0) + 1);

  const nodeIds = [...concepts.keys()].filter((id) => {
    const s = settingBy.get(id);
    if (s?.hidden && !opts.includeHidden) return false;
    if (opts.allFanOut || opts.conceptId) return true;
    return (fanOut.get(id) ?? 0) >= NODE_FANOUT_THRESHOLD || !!s?.promoted;
  });
  if (nodeIds.length === 0) return [];

  const sources = await resolveSources(orgId, nodeIds.map((id) => concepts.get(id)!));
  const sourcePageIds = [...new Set([...sources.values()].map((s) => s.pageId))];
  const versions = sourcePageIds.length
    ? await db.pageVersion.findMany({ where: { pageId: { in: sourcePageIds } }, select: { pageId: true, createdAt: true, contentHash: true }, orderBy: { createdAt: "asc" } })
    : [];
  const versionTimes = new Map<string, Array<{ at: Date; hash: string }>>();
  for (const v of versions) versionTimes.set(v.pageId, [...(versionTimes.get(v.pageId) ?? []), { at: v.createdAt, hash: v.contentHash }]);

  // "Also under": every chart node a page or asset sits beneath, across the whole org.
  const pageIds = [...new Set(pageEdges.map((e) => e.page.id))];
  const assetIds = [...new Set(extEdges.map((e) => e.asset.id))];
  const [allPageEdges, allExtEdges] = await Promise.all([
    pageIds.length ? db.pageConcept.findMany({ where: { pageId: { in: pageIds }, rel: { in: [...CHILD_RELS] } }, select: { pageId: true, concept: { select: { id: true, displayName: true } } } }) : [],
    assetIds.length ? db.externalEdge.findMany({ where: { assetId: { in: assetIds } }, select: { assetId: true, concept: { select: { id: true, displayName: true } } } }) : [],
  ]);
  const nodeTermsFor = async (ids: string[]) => {
    const missing = ids.filter((id) => !concepts.has(id));
    if (missing.length === 0) return;
    const rows = await db.concept.findMany({ where: { id: { in: missing } }, select: { id: true, normalizedName: true, displayName: true, kind: true } });
    for (const r of rows) concepts.set(r.id, r);
  };
  await nodeTermsFor([...allPageEdges.map((e) => e.concept.id), ...allExtEdges.map((e) => e.concept.id)]);
  // A concept counts as "also under" only if it is itself a chart node (fan-out or promoted).
  const allFan = new Map<string, number>();
  if (!opts.conceptId) for (const [id, n] of fanOut) allFan.set(id, n);
  else {
    const counts = await db.pageConcept.groupBy({ by: ["conceptId"], where: { rel: { in: [...CHILD_RELS] }, page: { orgId, status: { not: "archived" } } }, _count: { _all: true } });
    for (const c of counts) allFan.set(c.conceptId, c._count._all);
    const ext = await db.externalEdge.groupBy({ by: ["conceptId"], where: { asset: { orgId } }, _count: { _all: true } });
    for (const c of ext) allFan.set(c.conceptId, (allFan.get(c.conceptId) ?? 0) + c._count._all);
  }
  const allSettings = opts.conceptId ? new Map((await db.chartNodeSetting.findMany({ where: { orgId } })).map((s) => [s.conceptId, s])) : settingBy;
  const isNode = (id: string) => (allFan.get(id) ?? 0) >= NODE_FANOUT_THRESHOLD || !!allSettings.get(id)?.promoted;
  const pageAlso = new Map<string, string[]>();
  for (const e of allPageEdges) if (isNode(e.concept.id)) pageAlso.set(e.pageId, [...(pageAlso.get(e.pageId) ?? []), e.concept.displayName]);
  const assetAlso = new Map<string, string[]>();
  for (const e of allExtEdges) if (isNode(e.concept.id)) assetAlso.set(e.assetId, [...(assetAlso.get(e.assetId) ?? []), e.concept.displayName]);

  const out: ChartNodeDetail[] = [];
  for (const id of nodeIds) {
    const concept = concepts.get(id)!;
    const source = sources.get(id);
    const times = source ? versionTimes.get(source.pageId) ?? [] : [];
    // Content identical to what was there at the last check is not a move at all.
    const children: ChartChild[] = [];
    for (const e of pageEdges) {
      if (e.conceptId !== id) continue;
      if (source && e.page.id === source.pageId) continue;
      const { color, reason } = colorFor(e.verifiedAt, e.createdAt, e.needsChange, e.verifiedNote, null, source, times, now);
      children.push({
        kind: "page", edgeId: e.id, label: e.page.title, slug: e.page.slug, url: null, host: null, rel: e.rel, color, reason,
        lastCheckedAt: e.verifiedAt?.toISOString() ?? null, note: e.verifiedNote, owner: null, dueAt: null,
        alsoUnder: (pageAlso.get(e.page.id) ?? []).filter((t) => t !== concept.displayName), check: null,
      });
    }
    for (const e of extEdges) {
      if (e.conceptId !== id) continue;
      const { color, reason } = colorFor(e.verifiedAt, e.createdAt, e.needsChange, e.verifiedNote, e.dueAt, source, times, now);
      children.push({
        kind: "external", edgeId: e.id, label: e.asset.label, slug: null, url: e.asset.url, host: hostOf(e.asset.url), rel: e.rel, color, reason,
        lastCheckedAt: e.verifiedAt?.toISOString() ?? null, note: e.verifiedNote, owner: e.asset.owner, dueAt: e.dueAt?.toISOString() ?? null,
        alsoUnder: (assetAlso.get(e.asset.id) ?? []).filter((t) => t !== concept.displayName), check: e.asset.check ?? null,
      });
    }
    children.sort((a, b) => WORST.indexOf(a.color) - WORST.indexOf(b.color) || a.label.localeCompare(b.label));
    const counts: Record<ChartColor, number> = { green: 0, yellow: 0, red: 0 };
    let color: ChartColor = "green";
    for (const c of children) { counts[c.color]++; color = worst(color, c.color); }
    const s = settingBy.get(id) ?? allSettings.get(id);
    out.push({
      term: concept.displayName,
      kind: concept.kind || (source ? "source" : "topic"),
      title: source?.title ?? concept.displayName,
      source: source ? { slug: source.slug, title: source.title, updatedAt: source.updatedAt.toISOString(), updatedBy: source.updatedBy, status: source.status } : null,
      fanOut: children.length,
      color, counts,
      hidden: !!s?.hidden, promoted: !!s?.promoted, instructions: s?.instructions ?? null,
      group: groupFor(source?.status ?? null),
      children,
    });
  }
  // Attention first: red, then yellow, then green; ties by how much sits under the node.
  const rank: Record<ChartColor, number> = { red: 0, yellow: 1, green: 2 };
  out.sort((a, b) => rank[a.color] - rank[b.color] || b.fanOut - a.fanOut || a.term.localeCompare(b.term));
  return out;
}

function stripChildren(n: ChartNodeDetail): ChartNode {
  const { term, kind, title, source, fanOut, color, counts, hidden, promoted, instructions, group } = n;
  return { term, kind, title, source, fanOut, color, counts, hidden, promoted, instructions, group };
}

export async function getChart(orgId: string, opts: { includeHidden?: boolean } = {}): Promise<Chart> {
  const nodes = await build(orgId, { includeHidden: opts.includeHidden });
  const totals: Record<ChartColor, number> = { green: 0, yellow: 0, red: 0 };
  for (const n of nodes) for (const k of WORST) totals[k] += n.counts[k];
  return { nodes: nodes.map(stripChildren), totals };
}

export async function getChartNode(orgId: string, term: string): Promise<ChartNodeDetail> {
  const normalized = normalizeTerm(term);
  const concept = await findConceptForTerm(term, normalized);
  if (!concept) throw new Error(`concept not found: ${normalized}. get_chart lists every node.`);
  const [node] = await build(orgId, { conceptId: concept.id, includeHidden: true });
  if (!node) throw new Error(`concept not found: ${normalized}. get_chart lists every node.`);
  return node;
}

/** Everything yellow or red, grouped by node. The chart as a list. */
export async function getNeedsLook(orgId: string): Promise<Array<ChartNodeDetail>> {
  const nodes = await build(orgId, {});
  return nodes
    .map((n) => ({ ...n, children: n.children.filter((c) => c.color !== "green") }))
    .filter((n) => n.children.length > 0);
}

export async function setChartNode(orgId: string, term: string, patch: { hidden?: boolean; promoted?: boolean; sourceSlug?: string; instructions?: string | null }): Promise<ChartNode> {
  const normalized = normalizeTerm(term);
  const concept = await findConceptForTerm(term, normalized);
  if (!concept) throw new Error(`concept not found: ${normalized}`);
  if (patch.sourceSlug) {
    // Re-point the source of truth: the named page asserts this concept, any other asserter stops.
    const { upsertConcepts } = await import("./concepts");
    const page = await db.page.findUnique({ where: { orgId_slug: { orgId, slug: patch.sourceSlug } }, select: { id: true } });
    if (!page) throw new Error(`page not found: ${patch.sourceSlug}`);
    await db.pageConcept.deleteMany({ where: { conceptId: concept.id, rel: "asserts", pageId: { not: page.id }, page: { orgId } } });
    await upsertConcepts(page.id, [{ term, rel: "asserts" }], "system");
  }
  const flags = {
    ...(patch.hidden !== undefined ? { hidden: patch.hidden } : {}),
    ...(patch.promoted !== undefined ? { promoted: patch.promoted } : {}),
    // Empty string clears the note.
    ...(patch.instructions !== undefined ? { instructions: patch.instructions?.trim() ? patch.instructions.trim() : null } : {}),
  };
  if (Object.keys(flags).length === 0) return stripChildren(await getChartNode(orgId, term));
  await db.chartNodeSetting.upsert({
    where: { orgId_conceptId: { orgId, conceptId: concept.id } },
    create: { orgId, conceptId: concept.id, ...flags },
    update: flags,
  });
  return stripChildren(await getChartNode(orgId, term));
}

export interface PageImpact {
  /** Nodes this page is the source of, with what sits under each. */
  nodes: Array<{ term: string; pages: number; external: number }>;
  pages: number;
  external: number;
  /** One line for a toast or an agent's summary. Null when nothing sits under this page. */
  text: string | null;
}

/**
 * What a write to this page just turned yellow: every node the page is the
 * source of (asserts, or the template/component concept named by its slug)
 * and the count of children under each. Echoed in write responses and
 * toasted after a human save so awareness lands when it's cheap to act.
 */
export async function getPageImpact(orgId: string, slug: string): Promise<PageImpact> {
  const page = await db.page.findUnique({ where: { orgId_slug: { orgId, slug } }, select: { id: true } });
  const empty: PageImpact = { nodes: [], pages: 0, external: 0, text: null };
  if (!page) return empty;
  const asserted = await db.pageConcept.findMany({ where: { pageId: page.id, rel: "asserts" }, select: { conceptId: true } });
  const named = await db.concept.findMany({ where: { normalizedName: { in: [`template/${slug}`, `component/${slug}`] } }, select: { id: true } });
  const ids = [...new Set([...asserted.map((a) => a.conceptId), ...named.map((n) => n.id)])];
  if (ids.length === 0) return empty;
  const [pageEdges, extEdges, concepts] = await Promise.all([
    db.pageConcept.groupBy({ by: ["conceptId"], where: { conceptId: { in: ids }, rel: { in: [...CHILD_RELS] }, pageId: { not: page.id }, page: { orgId, status: { not: "archived" } } }, _count: { _all: true } }),
    db.externalEdge.groupBy({ by: ["conceptId"], where: { conceptId: { in: ids }, asset: { orgId } }, _count: { _all: true } }),
    db.concept.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } }),
  ]);
  const nodes = concepts.map((c) => ({
    term: c.displayName,
    pages: pageEdges.find((e) => e.conceptId === c.id)?._count._all ?? 0,
    external: extEdges.find((e) => e.conceptId === c.id)?._count._all ?? 0,
  })).filter((n) => n.pages + n.external > 0).sort((a, b) => b.pages + b.external - (a.pages + a.external));
  const pages = nodes.reduce((s, n) => s + n.pages, 0);
  const external = nodes.reduce((s, n) => s + n.external, 0);
  if (pages + external === 0) return empty;
  const parts = [pages ? `${pages} page${pages === 1 ? "" : "s"}` : null, external ? `${external} external` : null].filter(Boolean).join(" and ");
  const where = nodes.length === 1 ? nodes[0].term : `${nodes.length} nodes`;
  return { nodes, pages, external, text: `${parts} under ${where} need${pages + external === 1 ? "s" : ""} a look now. Agents can clear the pages; someone owns each external.` };
}

/**
 * Make a page a top-level node by hand. The page asserts a concept named
 * after its slug (or keeps the one it already asserts), and that concept is
 * promoted so it shows on the map before anything sits under it.
 */
export async function promotePageToNode(orgId: string, slug: string, createdBy: string): Promise<ChartNode> {
  const { upsertConcepts, normalizeTerm: norm } = await import("./concepts");
  const page = await db.page.findUnique({ where: { orgId_slug: { orgId, slug } }, select: { id: true } });
  if (!page) throw new Error(`page not found: ${slug}`);
  const existing = await db.pageConcept.findFirst({ where: { pageId: page.id, rel: "asserts" }, select: { concept: { select: { displayName: true } } } });
  const term = existing?.concept.displayName ?? norm(slug);
  if (!existing) await upsertConcepts(page.id, [{ term, rel: "asserts" }], createdBy);
  return setChartNode(orgId, term, { promoted: true });
}

export interface CreateNodeInput {
  /** Name shown on the map. Also the title of a page created here. */
  title: string;
  /** Existing page to use as the source. Omit to create one from the title. */
  slug?: string;
  /** Related content to put under it right away. */
  related?: Array<{ slug?: string; url?: string; label?: string }>;
}

/**
 * "Add top level content item": name it, point at the page that owns the
 * truth (or create that page now, as a stub with the name as its title),
 * then put the related content under it. One call from the form.
 */
export async function createNode(orgId: string, orgSlug: string, input: CreateNodeInput, createdBy: string): Promise<ChartNodeDetail> {
  const title = input.title.trim();
  if (!title) throw new Error("title is required");
  const { normalizeTerm: norm } = await import("./concepts");
  let slug = input.slug?.trim();
  if (!slug) {
    const { writePage } = await import("./pages");
    slug = norm(title).replace(/\//g, "-");
    if (!slug) throw new Error("title needs at least one letter or digit");
    const exists = await db.page.findUnique({ where: { orgId_slug: { orgId, slug } }, select: { id: true } });
    if (exists) throw new Error(`a page with slug ${slug} already exists; pick it as the source instead of creating a new one`);
    const yaml = `title: ${JSON.stringify(title)}\nshell: document\ncomponents:\n  - type: markdown\n    body: |\n      Source of truth for ${title}. Everything under it on the content chart needs a look when this page changes.\n`;
    const res = await writePage(orgId, orgSlug, slug, yaml, createdBy);
    if (!res.ok) throw new Error(res.error);
  }
  const node = await promotePageToNode(orgId, slug, createdBy);
  if (input.related?.length) {
    const { addScopeItem } = await import("./scope");
    for (const r of input.related) {
      if (!r.slug && !r.url) continue;
      if (r.slug === slug) continue;
      await addScopeItem(orgId, node.term, { slug: r.slug, url: r.url, label: r.label }, createdBy);
    }
  }
  return getChartNode(orgId, node.term);
}

export interface PageMapView {
  /** Nodes this page sits under, with this page's own row under each. */
  under: Array<{ node: ChartNode; me: ChartChild }>;
  /** The node this page is the source of, if any. */
  asNode: ChartNodeDetail | null;
}

/** The map from one page's point of view. Backs the page's Content map settings tab. */
export async function getPageMapView(orgId: string, slug: string): Promise<PageMapView> {
  const page = await db.page.findUnique({ where: { orgId_slug: { orgId, slug } }, select: { id: true } });
  if (!page) return { under: [], asNode: null };
  const edges = await db.pageConcept.findMany({
    where: { pageId: page.id, rel: { in: [...CHILD_RELS] } },
    select: { concept: { select: { displayName: true } } },
  });
  const under: PageMapView["under"] = [];
  for (const e of edges) {
    const node = await getChartNode(orgId, e.concept.displayName).catch(() => null);
    if (!node) continue;
    const me = node.children.find((c) => c.slug === slug);
    if (me) under.push({ node: stripChildren(node), me });
  }
  under.sort((a, b) => WORST.indexOf(a.me.color) - WORST.indexOf(b.me.color) || a.node.term.localeCompare(b.node.term));

  const asserts = await db.pageConcept.findFirst({ where: { pageId: page.id, rel: "asserts" }, select: { concept: { select: { displayName: true } } } });
  const named = asserts?.concept.displayName ?? (await db.concept.findFirst({ where: { normalizedName: { in: [`template/${slug}`, `component/${slug}`] } }, select: { displayName: true } }))?.displayName;
  const asNode = named ? await getChartNode(orgId, named).catch(() => null) : null;
  return { under, asNode };
}

export const STATUS_OPTIONS = ["Planned", "In progress", "Shipped"] as const;

/**
 * Set (or clear) the Status field on a node's source page. One source of
 * truth: the page's meta component. Null removes the field, which puts the
 * node back on Watching. Adds a meta component when the page has none.
 * Returns the page's new content hash, or throws when the node has no source.
 */
export async function setSourceStatus(orgId: string, orgSlug: string, term: string, status: string | null, createdBy: string): Promise<{ status: string | null }> {
  const node = await getChartNode(orgId, term);
  if (!node.source) throw new Error("this node has no source page; give it one before setting a status");
  const cur = await readPageYaml(orgId, node.source.slug);
  if (!cur) throw new Error(`page not found: ${node.source.slug}`);
  const doc = (yaml.load(cur.yaml) as { components?: Array<Record<string, unknown>>; [k: string]: unknown }) ?? {};
  const comps = Array.isArray(doc.components) ? doc.components : [];
  type Field = { key?: string; value?: unknown };
  const findMeta = (list: Array<Record<string, unknown>>): Record<string, unknown> | null => {
    for (const c of list) {
      if (c.type === "meta" && Array.isArray(c.fields)) return c;
      const inner = Array.isArray(c.components) ? findMeta(c.components as Array<Record<string, unknown>>) : null;
      if (inner) return inner;
    }
    return null;
  };
  let meta = findMeta(comps);
  const value = status?.trim() || null;
  if (!meta) {
    if (!value) return { status: null };
    meta = { id: "meta-status", type: "meta", fields: [] };
    // After a header if there is one, else at the top.
    const at = comps.findIndex((c) => c.type === "header");
    comps.splice(at >= 0 ? at + 1 : 0, 0, meta);
  }
  const fields = meta.fields as Field[];
  const idx = fields.findIndex((f) => typeof f.key === "string" && f.key.trim().toLowerCase() === "status");
  if (value) {
    if (idx >= 0) fields[idx] = { ...fields[idx], value }; else fields.push({ key: "Status", value });
  } else if (idx >= 0) {
    fields.splice(idx, 1);
  }
  doc.components = comps;
  const res = await writePage(orgId, orgSlug, node.source.slug, yaml.dump(doc, { lineWidth: -1, noRefs: true }), createdBy, cur.contentHash);
  if (!res.ok) throw new Error(res.error);
  return { status: value };
}
