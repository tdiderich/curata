import { db } from "./db";
import { CONCEPT_KINDS } from "./concept-kinds";
import { Prisma } from "@/generated/prisma/client";
import { makeTrustModeResolver, type TrustMode } from "./approval";

/**
 * How a page relates to a concept. `references` is the untyped default and
 * today's behavior. `depends` means the page is wrong if the concept changes.
 * `asserts` means the page is the source of truth for the concept.
 * `instantiates` is system-written by create_from_template and never by hand.
 */
export const CONCEPT_RELS = ["depends", "asserts", "references", "instantiates"] as const;
export type ConceptRel = (typeof CONCEPT_RELS)[number];
export const DEFAULT_REL: ConceptRel = "references";

export function isConceptRel(rel: unknown): rel is ConceptRel {
  return typeof rel === "string" && (CONCEPT_RELS as readonly string[]).includes(rel);
}

/** Concept term a page built from a template carries, so instances are searchable. */
export function templateConceptTerm(templateSlug: string): string {
  return `template/${templateSlug}`;
}

export interface ConceptInput {
  term: string;
  kind?: string;
  section?: string;
  /** Relation of the page to this concept. Omitted on an existing edge leaves it unchanged; omitted on a new edge means references. */
  rel?: ConceptRel;
  /** Detach this concept from the page instead of adding it. Never deletes the Concept itself. */
  remove?: boolean;
}

export interface LinkInput {
  target: string;
  rel: string;
  description?: string;
}

export interface ConceptOutput {
  term: string;
  kind: string;
  section: string | null;
  rel: string;
}

export interface LinkOutput {
  target: string;
  rel: string;
  description: string | null;
}

function slugPart(part: string): string {
  return part
    .toLowerCase()
    .trim()
    .replace(/[\s_/]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Terms are slugs: lowercase letters, digits, and hyphens only. Spaces and
 * underscores convert to hyphens, everything else is stripped, so
 * "Noise Reduction" and "noise-reduction" are the same concept.
 *
 * One interior "/" is kept as a namespace separator, so "feature/gcp-support"
 * and "template/pov-roi" survive. Further slashes in the tail become hyphens:
 * "a/b/c" -> "a/b-c". A slash with nothing on one side is dropped.
 */
export function normalizeTerm(term: string): string {
  const trimmed = term.trim().replace(/^\/+|\/+$/g, "");
  const idx = trimmed.indexOf("/");
  if (idx === -1) return slugPart(trimmed);
  const head = slugPart(trimmed.slice(0, idx));
  const tail = slugPart(trimmed.slice(idx + 1));
  if (head && tail) return `${head}/${tail}`;
  return head || tail;
}

/**
 * Pre-slug normalization (lowercase + trim + collapse whitespace, spaces
 * kept) — the algorithm normalizeTerm replaced. Rows written before terms
 * became slugs may still be keyed on this form in an environment where
 * scripts/normalize-concept-terms.ts hasn't run yet. Used only as a lookup
 * fallback so a multi-word legacy tag ("Prisma Cloud") merges into its
 * existing row instead of spawning a hyphenated duplicate. Safe to delete
 * once every environment has run the migration.
 */
function legacyNormalizeTerm(term: string): string {
  return term.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Finds a concept by its current slug name, falling back to the pre-slug
 * legacy form so not-yet-migrated rows still match.
 */
async function findConceptForTerm(rawTerm: string, normalized: string) {
  const bySlug = await db.concept.findUnique({ where: { normalizedName: normalized } });
  if (bySlug) return bySlug;
  const legacy = legacyNormalizeTerm(rawTerm);
  if (legacy === normalized) return null;
  return db.concept.findUnique({ where: { normalizedName: legacy } });
}

/**
 * Projects the resulting *set* of normalized concept terms a page will carry
 * after applying `incoming` on top of `existingTerms` — used by
 * required-components validation to check "will this page have at least one
 * concept tag" before upsertConcepts() actually runs (which happens after
 * the write, not before). Mirrors upsertConcepts' add/remove logic at the
 * term-membership level; it doesn't need section granularity, just whether
 * a term will still be attached.
 */
export function projectConceptTerms(existingTerms: string[], incoming?: ConceptInput[]): Set<string> {
  const terms = new Set(existingTerms.map((t) => normalizeTerm(t)).filter(Boolean));
  if (!incoming) return terms;
  for (const c of incoming) {
    const normalized = normalizeTerm(c.term);
    if (!normalized) continue;
    if (c.remove) terms.delete(normalized);
    else terms.add(normalized);
  }
  return terms;
}

type ConceptRow = NonNullable<Awaited<ReturnType<typeof findConceptForTerm>>>;

/** Find-or-create a concept row for a normalized term, racing safely. */
async function ensureConcept(rawTerm: string, normalized: string, existing: ConceptRow | null, kind?: string): Promise<ConceptRow> {
  if (existing) {
    // Also migrates a legacy multi-word row to the slug form the first
    // time it's touched, so it stops needing this fallback afterward.
    return db.concept.update({
      where: { id: existing.id },
      data: { normalizedName: normalized, displayName: normalized, kind: kind || undefined, updatedAt: new Date() },
    });
  }
  try {
    return await db.concept.create({
      data: { normalizedName: normalized, displayName: normalized, kind: kind || "", usageCount: 1 },
    });
  } catch (err) {
    // Two concurrent writers can both miss the lookup and race to create the
    // same slug; the loser falls back to the row the winner just created.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return db.concept.update({ where: { normalizedName: normalized }, data: { kind: kind || undefined, updatedAt: new Date() } });
    }
    throw err;
  }
}

/**
 * `verified` (default true): a new edge is verified as of now, because tagging
 * happens alongside a write or a human tagging the page they are looking at.
 * map_dependencies passes false: wiring an existing page into a graph is not
 * the same as checking it against the concept.
 */
export async function upsertConcepts(
  pageId: string,
  concepts: ConceptInput[],
  createdBy: string,
  opts: { verified?: boolean } = {}
): Promise<void> {
  const verifiedAt = opts.verified === false ? null : new Date();
  for (const c of concepts) {
    if (c.rel !== undefined && !isConceptRel(c.rel)) {
      throw new Error(`concepts[].rel must be one of ${CONCEPT_RELS.join("|")}, got ${JSON.stringify(c.rel)}`);
    }
    const normalized = normalizeTerm(c.term);
    if (!normalized) continue;

    const existing = await findConceptForTerm(c.term, normalized);

    if (c.remove) {
      if (!existing) continue;
      await db.pageConcept.deleteMany({ where: { pageId, conceptId: existing.id } });
      await db.concept.update({
        where: { id: existing.id },
        data: { usageCount: await db.pageConcept.count({ where: { conceptId: existing.id } }) },
      });
      continue;
    }

    const concept = await ensureConcept(c.term, normalized, existing, c.kind);

    await db.pageConcept.upsert({
      where: {
        pageId_conceptId_section: {
          pageId,
          conceptId: concept.id,
          section: c.section ?? "",
        },
      },
      create: {
        pageId,
        conceptId: concept.id,
        section: c.section ?? "",
        rel: c.rel ?? DEFAULT_REL,
        verifiedAt,
        createdBy,
      },
      // Re-tagging with a rel changes the edge; re-tagging without one leaves
      // whatever a human or agent already decided.
      update: { rel: c.rel ?? undefined },
    });

    await db.concept.update({
      where: { id: concept.id },
      data: {
        usageCount: await db.pageConcept.count({
          where: { conceptId: concept.id },
        }),
      },
    });
  }
}

export async function upsertLinks(
  orgId: string,
  fromPageId: string,
  links: LinkInput[],
  createdBy: string
): Promise<void> {
  // The caller passes the page's full declared link set, so anything not in it
  // is a stale edge from an earlier version of the page and gets pruned below.
  const declared = new Set<string>();

  for (const link of links) {
    const targetPage = await db.page.findUnique({
      where: { orgId_slug: { orgId, slug: link.target } },
    });
    if (!targetPage) continue;

    declared.add(`${targetPage.id}::${link.rel}`);

    await db.pageLink.upsert({
      where: {
        fromPageId_toPageId_rel: {
          fromPageId,
          toPageId: targetPage.id,
          rel: link.rel,
        },
      },
      create: {
        fromPageId,
        toPageId: targetPage.id,
        rel: link.rel,
        description: link.description ?? null,
        createdBy,
      },
      update: {
        description: link.description ?? undefined,
      },
    });
  }

  // Template lineage (rel: instantiates) is written by the system at
  // create_from_template time and is never part of a page's declared link
  // set, so it's exempt from the prune.
  const existing = await db.pageLink.findMany({
    where: { fromPageId, rel: { not: "instantiates" } },
    select: { id: true, toPageId: true, rel: true },
  });
  const staleIds = existing
    .filter((e) => !declared.has(`${e.toPageId}::${e.rel}`))
    .map((e) => e.id);
  if (staleIds.length > 0) {
    await db.pageLink.deleteMany({ where: { id: { in: staleIds } } });
  }
}

export async function getPageConcepts(pageId: string): Promise<ConceptOutput[]> {
  const rows = await db.pageConcept.findMany({
    where: { pageId },
    include: { concept: true },
  });
  return rows.map((r) => ({
    term: r.concept.displayName,
    kind: r.concept.kind,
    section: r.section || null,
    rel: r.rel,
  }));
}

export async function getPageLinks(
  orgId: string,
  pageId: string
): Promise<LinkOutput[]> {
  const rows = await db.pageLink.findMany({
    where: { fromPageId: pageId },
    include: { toPage: true },
  });
  return rows.map((r) => ({
    target: r.toPage.slug,
    rel: r.rel,
    description: r.description,
  }));
}

export async function getVocabulary(
  kind?: string,
  query?: string
): Promise<{
  concepts: Array<{ term: string; kind: string; usageCount: number }>;
  kinds: string[];
}> {
  const where: Record<string, unknown> = {};
  if (kind) where.kind = kind;
  if (query) where.normalizedName = { startsWith: normalizeTerm(query) };

  const concepts = await db.concept.findMany({
    where,
    orderBy: { usageCount: "desc" },
    take: 200,
  });

  const allKinds = await db.concept.findMany({
    select: { kind: true },
    distinct: ["kind"],
    where: { kind: { not: "" } },
  });

  return {
    concepts: concepts.map((c) => ({
      term: c.displayName,
      kind: c.kind,
      usageCount: c.usageCount,
    })),
    // Curated kinds first so agents converge on them; in-use extras follow.
    kinds: [...new Set([...CONCEPT_KINDS, ...allKinds.map((k) => k.kind)])],
  };
}

export async function getRelated(
  orgId: string,
  opts: { term?: string; slug?: string }
): Promise<{
  concepts: Array<{ term: string; kind: string; usageCount: number; rel?: string }>;
  pages: Array<{ slug: string; title: string; sharedConcepts: string[]; rel?: string }>;
  links: Array<{ from: string; to: string; rel: string }>;
}> {
  if (opts.term) {
    const normalized = normalizeTerm(opts.term);
    const concept = await db.concept.findUnique({
      where: { normalizedName: normalized },
      include: {
        // Concepts are global, so scope the page fan-out to the caller's org
        // and drop archived pages.
        pages: {
          where: { page: { orgId, status: { not: "archived" } } },
          include: { page: true },
        },
      },
    });

    if (!concept) return { concepts: [], pages: [], links: [] };

    return {
      concepts: [
        { term: concept.displayName, kind: concept.kind, usageCount: concept.usageCount },
      ],
      pages: concept.pages.map((pc) => ({
        slug: pc.page.slug,
        title: pc.page.title,
        sharedConcepts: [concept.displayName],
        rel: pc.rel,
      })),
      links: [],
    };
  }

  if (opts.slug) {
    const page = await db.page.findUnique({
      where: { orgId_slug: { orgId, slug: opts.slug } },
    });
    if (!page) return { concepts: [], pages: [], links: [] };

    const pageConcepts = await db.pageConcept.findMany({
      where: { pageId: page.id },
      include: { concept: true },
    });

    const conceptIds = pageConcepts.map((pc) => pc.conceptId);

    const relatedPageConcepts =
      conceptIds.length > 0
        ? await db.pageConcept.findMany({
            where: {
              conceptId: { in: conceptIds },
              pageId: { not: page.id },
              page: { orgId, status: { not: "archived" } },
            },
            include: { page: true, concept: true },
          })
        : [];

    const pageMap = new Map<string, { slug: string; title: string; concepts: Set<string> }>();
    for (const rpc of relatedPageConcepts) {
      const key = rpc.page.slug;
      if (!pageMap.has(key)) {
        pageMap.set(key, { slug: rpc.page.slug, title: rpc.page.title, concepts: new Set() });
      }
      pageMap.get(key)!.concepts.add(rpc.concept.displayName);
    }

    const pageLinks = await db.pageLink.findMany({
      where: {
        OR: [{ fromPageId: page.id }, { toPageId: page.id }],
        fromPage: { status: { not: "archived" } },
        toPage: { status: { not: "archived" } },
      },
      include: { fromPage: true, toPage: true },
    });

    return {
      concepts: pageConcepts.map((pc) => ({
        term: pc.concept.displayName,
        kind: pc.concept.kind,
        usageCount: pc.concept.usageCount,
        rel: pc.rel,
      })),
      pages: Array.from(pageMap.values())
        .map((p) => ({
          slug: p.slug,
          title: p.title,
          sharedConcepts: Array.from(p.concepts),
        }))
        .sort((a, b) => b.sharedConcepts.length - a.sharedConcepts.length),
      links: pageLinks.map((pl) => ({
        from: pl.fromPage.slug,
        to: pl.toPage.slug,
        rel: pl.rel,
      })),
    };
  }

  return { concepts: [], pages: [], links: [] };
}

export async function getSemanticMap(kind?: string): Promise<{
  concepts: Array<{
    term: string;
    kind: string;
    usageCount: number;
    pages: Array<{ slug: string; title: string; rel: string }>;
  }>;
  links: Array<{ from: string; to: string; rel: string }>;
  stats: {
    totalConcepts: number;
    totalLinks: number;
    pagesWithConcepts: number;
    pagesWithoutConcepts: number;
  };
}> {
  const conceptWhere: Record<string, unknown> = {};
  if (kind) conceptWhere.kind = kind;

  const concepts = await db.concept.findMany({
    where: conceptWhere,
    include: {
      pages: { include: { page: { select: { slug: true, title: true } } } },
    },
    orderBy: { usageCount: "desc" },
  });

  const allLinks = await db.pageLink.findMany({
    include: {
      fromPage: { select: { slug: true } },
      toPage: { select: { slug: true } },
    },
  });

  const pagesWithConcepts = new Set(
    concepts.flatMap((c) => c.pages.map((pc) => pc.page.slug))
  ).size;


  const totalPages = await db.page.count();

  return {
    concepts: concepts.map((c) => ({
      term: c.displayName,
      kind: c.kind,
      usageCount: c.usageCount,
      pages: c.pages.map((pc) => ({ slug: pc.page.slug, title: pc.page.title, rel: pc.rel })),
    })),
    links: allLinks.map((l) => ({
      from: l.fromPage.slug,
      to: l.toPage.slug,
      rel: l.rel,
    })),
    stats: {
      totalConcepts: concepts.length,
      totalLinks: allLinks.length,
      pagesWithConcepts,
      pagesWithoutConcepts: totalPages - pagesWithConcepts,
    },
  };
}

export interface DependentPage {
  slug: string;
  title: string;
  folderId: string | null;
  /** Relation of that page to the concept in question. */
  rel: string;
  /** Concept the edge runs through. */
  via: string;
  trusted: boolean;
  trustedBehind: boolean;
  updatedAt: string;
  /**
   * When this page was last confirmed right with respect to `via`. Per edge:
   * a page that depends on pricing and on the tagline is checked for each.
   * Any write bumps every edge; mark_verified bumps one. Null = never.
   */
  verifiedAt: string | null;
  /** Why, when mark_verified said so ("does not quote the price"). */
  verifiedNote: string | null;
  /** Someone looked and it is wrong. Set by mark_verified status=needs_change. */
  needsChange: boolean;
  /** True when the concept's source of truth changed after this edge was last verified, or nobody has looked. */
  staleAgainstSource: boolean;
  /** Set when this row was pulled in through an included sub-map, to the term of that sub-map's root concept. Undefined for a direct edge. */
  group?: string;
}

export interface ExternalDependentRow {
  /** Edge id. */
  id: string;
  assetId: string;
  url: string;
  host: string;
  label: string;
  owner: string | null;
  rel: string;
  via: string;
  /** Other concepts this same asset is tracked against. */
  alsoDependsOn: string[];
  verifiedAt: string | null;
  verifiedNote: string | null;
  needsChange: boolean;
  staleAgainstSource: boolean;
  /** Set when this row was pulled in through an included sub-map, to the term of that sub-map's root concept. Undefined for a direct edge. */
  group?: string;
}

export interface DependentsSummary {
  pages: { total: number; ok: number; stale: number; needsChange: number; neverVerified: number };
  external: { total: number; ok: number; stale: number; needsChange: number; neverChecked: number };
  /** One line an agent can hand a human as-is. */
  text: string;
}

export interface DependentsResult {
  /** The page this was asked about, when called by slug. */
  page?: { slug: string; title: string };
  /** The concept this was asked about, when called by term. */
  concept?: { term: string; kind: string; usageCount: number };
  /** Concepts the page carries, with rel. Slug mode only. */
  concepts: Array<{ term: string; kind: string; rel: string }>;
  /** Pages that assert a concept this page depends on (slug mode), or that assert the concept (term mode). */
  asserters: DependentPage[];
  /** Pages with a depends edge on a concept this page asserts (slug mode) or on the concept (term mode). */
  dependents: DependentPage[];
  /** Pages built from this template page (slug mode) or from the template concept (term mode). */
  instances: DependentPage[];
  /** Concepts this page depends on that have no asserter anywhere in the org. */
  asserterGaps: string[];
  /** Assets outside curata (Drive, GitHub, ...) that depend on the concept(s). Edges, not pages. */
  external: ExternalDependentRow[];
  /** Sub-maps included by this concept (term mode only). Their own depends/external are already merged into dependents/external above, tagged with group; this lists just the child roots and their own roll-up. */
  includes: Array<{ term: string; kind: string; summary: DependentsSummary }>;
  /** True if the include tree was cut off by the depth cap (defensive; writes refuse cycles, this guards a race). */
  truncated: boolean;
  /** Counts over dependents + instances + external, so a caller can answer "what still needs a look" without walking rows. */
  summary: DependentsSummary;
}

type PageConceptWithPage = {
  rel: string;
  verifiedAt: Date | null;
  verifiedNote: string | null;
  needsChange: boolean;
  concept: { id: string; displayName: string; kind: string; usageCount: number };
  page: {
    slug: string;
    title: string;
    folderId: string | null;
    rules: unknown;
    trustedVersionId: string | null;
    updatedAt: Date;
    versions: Array<{ id: string }>;
  };
};

const DEPENDENT_PAGE_INCLUDE = {
  concept: true,
  page: {
    select: {
      slug: true,
      title: true,
      folderId: true,
      rules: true,
      trustedVersionId: true,
      updatedAt: true,
      versions: { orderBy: { createdAt: "desc" as const }, take: 1, select: { id: true } },
    },
  },
};

function isStale(verifiedAt: Date | null, sourceUpdatedAt: Date | undefined): boolean {
  if (!sourceUpdatedAt) return false;
  if (!verifiedAt) return true;
  return verifiedAt < sourceUpdatedAt;
}

// Trust follows the same page > folder > org > "auto" resolution as every
// read path: in auto mode latest is trusted by definition, so a page with
// no pinned version is not "untrusted", it is simply not locked.
function toDependentPage(row: PageConceptWithPage, trustMode: TrustMode, sourceUpdatedAt: Date | undefined, group?: string): DependentPage {
  const latestId = row.page.versions[0]?.id ?? null;
  const trusted = trustMode === "auto" || !!row.page.trustedVersionId;
  return {
    slug: row.page.slug,
    title: row.page.title,
    folderId: row.page.folderId,
    rel: row.rel,
    via: row.concept.displayName,
    trusted,
    trustedBehind: trustMode === "locked" && trusted && latestId !== null && row.page.trustedVersionId !== latestId,
    updatedAt: row.page.updatedAt.toISOString(),
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    verifiedNote: row.verifiedNote,
    needsChange: row.needsChange,
    // A page that asserts the concept is its own source; never stale.
    staleAgainstSource: row.rel === "asserts" ? false : row.needsChange || isStale(row.verifiedAt, sourceUpdatedAt),
    ...(group ? { group } : {}),
  };
}

function hostOf(url: string): string {
  try { return new URL(url).host.replace(/^www\./, ""); } catch { return url; }
}

/**
 * Canonical form for an external URL so the same Drive deck tagged from two
 * places is one asset. Drops the fragment and trailing slash; on Google Docs
 * hosts also drops the action segment (/edit, /view) and query, which vary
 * per share link but point at the same file.
 */
export function normalizeExternalUrl(raw: string): string {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new Error(`external url must be absolute http(s): ${JSON.stringify(raw)}`); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(`external url must be http(s): ${JSON.stringify(raw)}`);
  u.hash = "";
  u.host = u.host.toLowerCase();
  if (/(^|\.)docs\.google\.com$/.test(u.host) || /(^|\.)drive\.google\.com$/.test(u.host)) {
    u.search = "";
    u.pathname = u.pathname.replace(/\/(edit|view|preview|copy)$/, "");
  }
  let out = u.toString();
  if (out.endsWith("/") && u.pathname !== "/") out = out.slice(0, -1);
  return out;
}

type ExternalEdgeRow = {
  id: string;
  rel: string;
  verifiedAt: Date | null;
  verifiedNote: string | null;
  needsChange: boolean;
  concept: { id: string; displayName: string };
  asset: {
    id: string;
    url: string;
    label: string;
    owner: string | null;
    edges: Array<{ concept: { displayName: string } }>;
  };
};

const EXTERNAL_EDGE_INCLUDE = {
  concept: { select: { id: true, displayName: true } },
  asset: {
    select: {
      id: true,
      url: true,
      label: true,
      owner: true,
      edges: { select: { concept: { select: { displayName: true } } } },
    },
  },
};

function toExternalRow(row: ExternalEdgeRow, sourceUpdatedAt: Date | undefined, group?: string): ExternalDependentRow {
  return {
    id: row.id,
    assetId: row.asset.id,
    url: row.asset.url,
    host: hostOf(row.asset.url),
    label: row.asset.label,
    owner: row.asset.owner,
    rel: row.rel,
    via: row.concept.displayName,
    alsoDependsOn: row.asset.edges.map((e) => e.concept.displayName).filter((t) => t !== row.concept.displayName).sort(),
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    verifiedNote: row.verifiedNote,
    needsChange: row.needsChange,
    // An asset nobody has checked is stale on its face, source or not.
    staleAgainstSource: row.needsChange || row.verifiedAt === null || isStale(row.verifiedAt, sourceUpdatedAt),
    ...(group ? { group } : {}),
  };
}

/**
 * Per-context verification override. An edge's own verifiedAt/verifiedNote/
 * needsChange columns are the record "for the concept this edge is tagged
 * to" (contextConceptId === row's own concept). Viewed through an include
 * from a DIFFERENT root, that base record must not apply - verifying a
 * shared leaf for one launch would otherwise silently clear staleness for
 * every other launch that includes the same group. If no override row
 * exists yet for that other context, the row reads as never checked for
 * it, not as whatever the base fields happen to say.
 */
function applyContext<T extends { id: string; verifiedAt: Date | null; verifiedNote: string | null; needsChange: boolean; concept: { id: string } }>(
  row: T,
  edgeType: "page" | "external",
  contextConceptId: string,
  contextMap: Map<string, { verifiedAt: Date; verifiedNote: string | null; needsChange: boolean }>
): T {
  if (row.concept.id === contextConceptId) return row;
  const ctx = contextMap.get(`${edgeType}:${row.id}`);
  if (ctx) return { ...row, verifiedAt: ctx.verifiedAt, verifiedNote: ctx.verifiedNote, needsChange: ctx.needsChange };
  return { ...row, verifiedAt: null, verifiedNote: null, needsChange: false };
}

/** Batch-fetch every context override for a set of edge ids under one context concept, keyed "type:id" for applyContext. */
async function loadVerificationContexts(
  contextConceptId: string,
  pageEdgeIds: string[],
  externalEdgeIds: string[]
): Promise<Map<string, { verifiedAt: Date; verifiedNote: string | null; needsChange: boolean }>> {
  const out = new Map<string, { verifiedAt: Date; verifiedNote: string | null; needsChange: boolean }>();
  const rows = await db.conceptVerificationContext.findMany({
    where: {
      contextConceptId,
      OR: [
        ...(pageEdgeIds.length ? [{ edgeType: "page", edgeId: { in: pageEdgeIds } }] : []),
        ...(externalEdgeIds.length ? [{ edgeType: "external", edgeId: { in: externalEdgeIds } }] : []),
      ],
    },
    select: { edgeType: true, edgeId: true, verifiedAt: true, verifiedNote: true, needsChange: true },
  });
  for (const r of rows) out.set(`${r.edgeType}:${r.edgeId}`, { verifiedAt: r.verifiedAt, verifiedNote: r.verifiedNote, needsChange: r.needsChange });
  return out;
}

/**
 * Include one map (child) as a sub-map of another (parent): the parent's
 * /map view pulls in the child's depends/external, and mark_verified on a
 * pulled-in row can be scoped to the parent's context so a shared group
 * does not carry verification state between the maps that include it.
 * Refuses a cycle: parent cannot already be reachable from child.
 */
export async function includeMap(orgId: string, parentTerm: string, childTerm: string, createdBy: string): Promise<{ parent: string; child: string }> {
  const parentNorm = normalizeTerm(parentTerm);
  const childNorm = normalizeTerm(childTerm);
  if (!parentNorm || !childNorm) throw new Error("parent and child terms are required");
  if (parentNorm === childNorm) throw new Error(`a map cannot include itself: ${parentNorm}`);
  const parent = await ensureConcept(parentTerm, parentNorm, await findConceptForTerm(parentTerm, parentNorm));
  const child = await findConceptForTerm(childTerm, childNorm);
  if (!child) throw new Error(`concept not found: ${childNorm}. Create it first (map_dependencies or a tag) before including it.`);

  const descendants = await collectIncludedConceptIds(child.id, 6);
  if (descendants.has(parent.id)) {
    throw new Error(`including ${childNorm} in ${parentNorm} would create a cycle: ${childNorm} already includes ${parentNorm} (directly or transitively)`);
  }

  await db.conceptInclude.upsert({
    where: { parentId_childId: { parentId: parent.id, childId: child.id } },
    create: { parentId: parent.id, childId: child.id, createdBy },
    update: {},
  });
  return { parent: parent.displayName, child: child.displayName };
}

/** Detach a sub-map from a parent. No-op if it was not included. */
export async function removeIncludeMap(orgId: string, parentTerm: string, childTerm: string): Promise<void> {
  const parent = await findConceptForTerm(parentTerm, normalizeTerm(parentTerm));
  const child = await findConceptForTerm(childTerm, normalizeTerm(childTerm));
  if (!parent || !child) return;
  await db.conceptInclude.deleteMany({ where: { parentId: parent.id, childId: child.id } });
}

/** BFS over ConceptInclude, child -> grandchildren, depth-capped, cycle-safe via visited set. */
async function collectIncludedConceptIds(rootId: string, maxDepth: number): Promise<Set<string>> {
  const seen = new Set<string>([rootId]);
  let frontier = [rootId];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const rows = await db.conceptInclude.findMany({ where: { parentId: { in: frontier } }, select: { childId: true } });
    const next: string[] = [];
    for (const r of rows) {
      if (!seen.has(r.childId)) { seen.add(r.childId); next.push(r.childId); }
    }
    frontier = next;
  }
  return seen;
}

function summarize(pages: DependentPage[], external: ExternalDependentRow[]): DependentsSummary {
  // Buckets are exclusive: needs update > never verified > source changed > ok.
  const p = { total: pages.length, ok: 0, stale: 0, needsChange: 0, neverVerified: 0 };
  for (const d of pages) {
    if (d.needsChange) p.needsChange++;
    else if (d.verifiedAt === null) p.neverVerified++;
    else if (d.staleAgainstSource) p.stale++;
    else p.ok++;
  }
  const e = { total: external.length, ok: 0, stale: 0, needsChange: 0, neverChecked: 0 };
  for (const x of external) {
    if (x.needsChange) e.needsChange++;
    else if (x.verifiedAt === null) e.neverChecked++;
    else if (x.staleAgainstSource) e.stale++;
    else e.ok++;
  }
  const total = p.total + e.total;
  const ok = p.ok + e.ok;
  const needsChange = p.needsChange + e.needsChange;
  const never = p.neverVerified + e.neverChecked;
  const changed = p.stale + e.stale;
  let text: string;
  if (total === 0) text = "Nothing depends on this yet.";
  else if (ok === total) text = `All ${total} checked.`;
  else {
    const parts: string[] = [];
    if (needsChange) parts.push(`${needsChange} need${needsChange === 1 ? "s" : ""} an update`);
    if (never) parts.push(`${never} never checked`);
    if (changed) parts.push(`${changed} not checked since the source changed`);
    text = `${total - ok} of ${total} need a look: ${parts.join(", ")}.`;
  }
  return { pages: p, external: e, text };
}

/** Latest updatedAt across the pages that assert each concept: "when did the truth last move". */
async function sourceUpdatedAtByConcept(orgId: string, conceptIds: string[]): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  if (conceptIds.length === 0) return out;
  const rows = await db.pageConcept.findMany({
    where: { conceptId: { in: conceptIds }, rel: "asserts", page: { orgId, status: { not: "archived" } } },
    select: { conceptId: true, page: { select: { updatedAt: true } } },
  });
  for (const r of rows) {
    const cur = out.get(r.conceptId);
    if (!cur || r.page.updatedAt > cur) out.set(r.conceptId, r.page.updatedAt);
  }
  return out;
}

/**
 * Writing is verifying: after any write to a page, every edge it carries is
 * confirmed as of now and any earlier note or needs-change flag goes, because
 * the new content speaks for itself. Called from the page write path and from
 * markTrusted.
 */
export async function verifyAllEdgesForPage(pageId: string): Promise<void> {
  await db.pageConcept.updateMany({
    where: { pageId },
    data: { verifiedAt: new Date(), verifiedNote: null, needsChange: false },
  });
}

export interface ExternalDependentInput {
  url: string;
  label?: string;
  owner?: string;
  rel?: ConceptRel;
  remove?: boolean;
}

/**
 * Attach assets outside curata to a concept. One asset per (org, url), one
 * edge per (asset, concept). Re-tagging updates label/owner on the asset and
 * rel on the edge, and leaves verification alone. A new edge starts
 * unverified: attaching a deck to a concept is not the same as opening the
 * deck and checking it, and a graph that reads "all checked" the second it
 * is built hides exactly the rows most likely to be wrong.
 */
export async function upsertExternalDependents(
  orgId: string,
  term: string,
  items: ExternalDependentInput[],
  createdBy: string
): Promise<ExternalDependentRow[]> {
  const normalized = normalizeTerm(term);
  if (!normalized) throw new Error("term is required");
  const concept = await ensureConcept(term, normalized, await findConceptForTerm(term, normalized));
  const out: ExternalDependentRow[] = [];
  for (const item of items) {
    if (item.rel !== undefined && !isConceptRel(item.rel)) {
      throw new Error(`external[].rel must be one of ${CONCEPT_RELS.join("|")}, got ${JSON.stringify(item.rel)}`);
    }
    const url = normalizeExternalUrl(item.url);
    if (item.remove) {
      const asset = await db.externalAsset.findUnique({ where: { orgId_url: { orgId, url } }, select: { id: true } });
      if (!asset) continue;
      await db.externalEdge.deleteMany({ where: { assetId: asset.id, conceptId: concept.id } });
      // An asset with no edges left is not tracked against anything; drop it.
      const remaining = await db.externalEdge.count({ where: { assetId: asset.id } });
      if (remaining === 0) await db.externalAsset.delete({ where: { id: asset.id } });
      continue;
    }
    const label = item.label?.trim();
    const asset = await db.externalAsset.upsert({
      where: { orgId_url: { orgId, url } },
      create: { orgId, url, label: label || hostOf(url) + new URL(url).pathname, owner: item.owner ?? null, createdBy },
      update: { label: label || undefined, owner: item.owner ?? undefined },
    });
    const edge = await db.externalEdge.upsert({
      where: { assetId_conceptId: { assetId: asset.id, conceptId: concept.id } },
      create: { assetId: asset.id, conceptId: concept.id, rel: item.rel ?? "depends", createdBy },
      update: { rel: item.rel ?? undefined },
      include: EXTERNAL_EDGE_INCLUDE,
    });
    out.push(toExternalRow(edge, undefined));
  }
  return out;
}

export const VERIFY_STATUSES = ["holds", "needs_change"] as const;
export type VerifyStatus = (typeof VERIFY_STATUSES)[number];

/**
 * "Looked at it." Records the outcome on the edge(s) named:
 *  - slug + term: that page's edge to that concept
 *  - slug alone: every edge the page carries
 *  - url + term: that asset's edge to that concept
 *  - url alone: every edge the asset carries
 * status "holds" (default) clears stale; "needs_change" marks the edge as
 * checked-and-wrong, which reads as stale until a write or a later holds.
 * Never writes a version or moves the trust pointer.
 */
export async function verifyDependent(
  orgId: string,
  target: { slug?: string; url?: string; term?: string; context?: string; note?: string; status?: VerifyStatus }
): Promise<{ kind: "page" | "external"; id: string; term: string | null; context: string | null; status: VerifyStatus; verifiedAt: string; note: string | null; count: number }> {
  const now = new Date();
  const note = target.note?.trim() || null;
  const status: VerifyStatus = target.status ?? "holds";
  if (!VERIFY_STATUSES.includes(status)) throw new Error(`status must be one of ${VERIFY_STATUSES.join("|")}`);
  if (target.context && !target.term) throw new Error("term is required when context is given (context scopes verification of the term's edge to a different root)");

  let conceptId: string | undefined;
  let termOut: string | null = null;
  if (target.term) {
    const normalizedTerm = normalizeTerm(target.term);
    const concept = await findConceptForTerm(target.term, normalizedTerm);
    if (!concept) throw new Error(`concept not found: ${normalizedTerm}`);
    conceptId = concept.id;
    termOut = concept.displayName;
  }

  let contextConceptId: string | undefined;
  let contextOut: string | null = null;
  if (target.context) {
    const normalizedContext = normalizeTerm(target.context);
    const contextConcept = await findConceptForTerm(target.context, normalizedContext);
    if (!contextConcept) throw new Error(`concept not found: ${normalizedContext}`);
    contextOut = contextConcept.displayName;
    // Context equal to the edge's own concept is just the base record.
    if (contextConcept.id !== conceptId) contextConceptId = contextConcept.id;
  }

  async function writeContextRows(edgeType: "page" | "external", edgeIds: string[]): Promise<void> {
    if (!contextConceptId) return;
    for (const edgeId of edgeIds) {
      await db.conceptVerificationContext.upsert({
        where: { edgeType_edgeId_contextConceptId: { edgeType, edgeId, contextConceptId } },
        create: { edgeType, edgeId, contextConceptId, verifiedAt: now, verifiedNote: note, needsChange: status === "needs_change", createdBy: "agent" },
        update: { verifiedAt: now, verifiedNote: note, needsChange: status === "needs_change" },
      });
    }
  }

  const data = { verifiedAt: now, verifiedNote: note, needsChange: status === "needs_change" };

  if (target.slug) {
    const page = await db.page.findUnique({ where: { orgId_slug: { orgId, slug: target.slug } }, select: { id: true } });
    if (!page) throw new Error(`page not found: ${target.slug}`);
    const rows = await db.pageConcept.findMany({ where: { pageId: page.id, ...(conceptId ? { conceptId } : {}) }, select: { id: true } });
    if (rows.length === 0) {
      throw new Error(conceptId
        ? `${target.slug} has no edge to ${termOut}; tag it first (map_dependencies or concepts on write_page)`
        : `${target.slug} carries no concept tags, nothing to verify`);
    }
    if (contextConceptId) {
      await writeContextRows("page", rows.map((r) => r.id));
    } else {
      await db.pageConcept.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data });
    }
    return { kind: "page", id: target.slug, term: termOut, context: contextOut, status, verifiedAt: now.toISOString(), note, count: rows.length };
  }
  if (target.url) {
    const url = normalizeExternalUrl(target.url);
    const asset = await db.externalAsset.findUnique({ where: { orgId_url: { orgId, url } }, select: { id: true } });
    if (!asset) throw new Error(`no external asset tracked at ${url}`);
    const rows = await db.externalEdge.findMany({ where: { assetId: asset.id, ...(conceptId ? { conceptId } : {}) }, select: { id: true } });
    if (rows.length === 0) throw new Error(`${url} is not tracked against ${termOut}`);
    if (contextConceptId) {
      await writeContextRows("external", rows.map((r) => r.id));
    } else {
      await db.externalEdge.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data });
    }
    return { kind: "external", id: url, term: termOut, context: contextOut, status, verifiedAt: now.toISOString(), note, count: rows.length };
  }
  throw new Error("slug or url is required");
}

export interface MapDependenciesInput {
  term: string;
  kind?: string;
  /** Pages that own the truth for this concept. */
  asserts?: string[];
  /** Pages that go stale when it changes. */
  depends?: string[];
  /** Pages that merely mention it. */
  references?: string[];
  /** Assets outside curata that go stale when it changes. */
  external?: ExternalDependentInput[];
  /** Other maps (concept terms) to pull in as sub-maps. Reported in missingIncludes, not thrown, if a term does not exist yet. */
  includes?: string[];
  /** Detach these sub-maps. No error if they were not included. */
  removeIncludes?: string[];
}

/**
 * Build a whole dependency graph around one concept in one call: tag every
 * listed page with the matching rel, attach the external assets, and wire
 * up sub-maps. Additive, never removes edges (removeIncludes is the one
 * exception, for the edit form). Unknown slugs and unknown include terms
 * are reported back, not thrown, so one typo does not lose the rest.
 */
export async function mapDependencies(
  orgId: string,
  input: MapDependenciesInput,
  createdBy: string
): Promise<{ term: string; tagged: Array<{ slug: string; rel: ConceptRel }>; external: ExternalDependentRow[]; missing: string[]; includes: string[]; missingIncludes: string[] }> {
  const normalized = normalizeTerm(input.term);
  if (!normalized) throw new Error("term is required");
  const tagged: Array<{ slug: string; rel: ConceptRel }> = [];
  const missing: string[] = [];
  const groups: Array<[ConceptRel, string[] | undefined]> = [
    ["asserts", input.asserts],
    ["depends", input.depends],
    ["references", input.references],
  ];
  for (const [rel, slugs] of groups) {
    for (const slug of slugs ?? []) {
      const page = await db.page.findUnique({ where: { orgId_slug: { orgId, slug } }, select: { id: true } });
      if (!page) { missing.push(slug); continue; }
      await upsertConcepts(page.id, [{ term: input.term, kind: input.kind, rel }], createdBy, { verified: false });
      tagged.push({ slug, rel });
    }
  }
  const external = input.external?.length
    ? await upsertExternalDependents(orgId, input.term, input.external, createdBy)
    : [];
  for (const childTerm of input.removeIncludes ?? []) {
    await removeIncludeMap(orgId, input.term, childTerm);
  }
  const includes: string[] = [];
  const missingIncludes: string[] = [];
  for (const childTerm of input.includes ?? []) {
    try {
      const r = await includeMap(orgId, input.term, childTerm, createdBy);
      includes.push(r.child);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("concept not found")) { missingIncludes.push(childTerm); continue; }
      throw err;
    }
  }
  if (tagged.length === 0 && external.length === 0 && missing.length === 0 && includes.length === 0 && missingIncludes.length === 0 && !(input.removeIncludes?.length)) {
    throw new Error("nothing to map: pass asserts, depends, references, external, or includes");
  }
  return { term: normalized, tagged, external, missing, includes, missingIncludes };
}

/**
 * Directional view of the concept graph, depth 1. Answers "what breaks if
 * this changes" (dependents), "who owns the truth" (asserters), and "what
 * was built from this" (instances). Org-scoped, archived pages excluded.
 */
export async function getDependents(
  orgId: string,
  opts: { slug?: string; term?: string; rel?: ConceptRel }
): Promise<DependentsResult> {
  const empty: DependentsResult = { concepts: [], asserters: [], dependents: [], instances: [], asserterGaps: [], external: [], includes: [], truncated: false, summary: summarize([], []) };
  const pageScope = { orgId, status: { not: "archived" } };

  const [trustFolders, trustOrg] = await Promise.all([
    db.folder.findMany({ where: { orgId }, select: { id: true, parentId: true, name: true, rules: true } }),
    db.organization.findUnique({ where: { id: orgId }, select: { rules: true } }),
  ]);
  const resolveTrust = makeTrustModeResolver(trustFolders, trustOrg?.rules);

  async function edges(conceptIds: string[], rels: ConceptRel[], excludePageId?: string): Promise<DependentPage[]> {
    if (conceptIds.length === 0) return [];
    const sources = await sourceUpdatedAtByConcept(orgId, conceptIds);
    const rows = await db.pageConcept.findMany({
      where: {
        conceptId: { in: conceptIds },
        rel: { in: rels },
        ...(excludePageId ? { pageId: { not: excludePageId } } : {}),
        page: pageScope,
      },
      include: DEPENDENT_PAGE_INCLUDE,
      orderBy: { page: { updatedAt: "desc" } },
    });
    return rows.map((row) => toDependentPage(row, resolveTrust(row.page.folderId, row.page.rules), sources.get(row.concept.id)));
  }

  async function externals(conceptIds: string[], rel?: ConceptRel): Promise<ExternalDependentRow[]> {
    if (conceptIds.length === 0) return [];
    const [rows, sources] = await Promise.all([
      db.externalEdge.findMany({
        where: { conceptId: { in: conceptIds }, asset: { orgId }, ...(rel ? { rel } : {}) },
        include: EXTERNAL_EDGE_INCLUDE,
        orderBy: { updatedAt: "desc" },
      }),
      sourceUpdatedAtByConcept(orgId, conceptIds),
    ]);
    return rows.map((r) => toExternalRow(r, sources.get(r.conceptId)));
  }

  if (opts.term) {
    const normalized = normalizeTerm(opts.term);
    const concept = await findConceptForTerm(opts.term, normalized);
    if (!concept) {
      // An invented term used to come back as an empty graph, indistinguishable
      // from "nothing depends on this". Fail loudly and point at what exists.
      // Match on any token of 3+ chars so "tier-2-pricing" finds "pricing/tier-2".
      const tokens = [...new Set(normalized.split(/[\/-]/).filter((t) => t.length >= 3))];
      const near = tokens.length === 0 ? [] : await db.concept.findMany({
        where: {
          OR: tokens.map((t) => ({ normalizedName: { contains: t } })),
          pages: { some: { page: { orgId } } },
        },
        select: { normalizedName: true },
        orderBy: { usageCount: "desc" },
        take: 25,
      });
      near.sort((a, b) =>
        tokens.filter((t) => b.normalizedName.includes(t)).length - tokens.filter((t) => a.normalizedName.includes(t)).length
      );
      near.splice(5);
      const hint = near.length > 0
        ? ` Did you mean: ${near.map((n) => n.normalizedName).join(", ")}? get_vocabulary lists every concept in use.`
        : " get_vocabulary lists every concept in use; map_dependencies creates one.";
      throw new Error(`concept not found: ${normalized}.${hint}`);
    }
    const filter = (r: ConceptRel) => !opts.rel || opts.rel === r;
    const [asserters, dependents, instances, external] = await Promise.all([
      filter("asserts") ? edges([concept.id], ["asserts"]) : [],
      filter("depends") ? edges([concept.id], ["depends"]) : [],
      filter("instantiates") ? edges([concept.id], ["instantiates"]) : [],
      externals([concept.id], opts.rel),
    ]);

    // Sub-maps: pull each direct include's own depends/external into this
    // view, verification resolved against THIS concept as context so a
    // group shared by two maps never shows one map's check on the other's.
    const MAX_INCLUDE_DEPTH = 4;
    const includeRows = await db.conceptInclude.findMany({
      where: { parentId: concept.id },
      select: { child: { select: { id: true, displayName: true, kind: true } } },
      orderBy: { createdAt: "asc" },
    });
    const includesOut: DependentsResult["includes"] = [];
    let mergedDependents = dependents;
    let mergedExternal = external;
    let truncated = false;
    if (includeRows.length > 0 && (filter("depends"))) {
      const seenPageKey = new Set(mergedDependents.map((d) => d.slug));
      const seenExtKey = new Set(mergedExternal.map((e) => e.url));
      const visitedConcepts = new Set<string>([concept.id]);
      let frontier = includeRows.map((r) => ({ id: r.child.id, term: r.child.displayName, kind: r.child.kind, group: r.child.displayName }));
      for (let depth = 0; depth < MAX_INCLUDE_DEPTH && frontier.length > 0; depth++) {
        const nextFrontier: typeof frontier = [];
        for (const node of frontier) {
          if (visitedConcepts.has(node.id)) continue;
          visitedConcepts.add(node.id);

          const [rawPageRows, rawExtRows, childSources] = await Promise.all([
            db.pageConcept.findMany({
              where: { conceptId: node.id, rel: "depends", page: pageScope },
              include: DEPENDENT_PAGE_INCLUDE,
              orderBy: { page: { updatedAt: "desc" } },
            }),
            db.externalEdge.findMany({
              where: { conceptId: node.id, rel: "depends", asset: { orgId } },
              include: EXTERNAL_EDGE_INCLUDE,
              orderBy: { updatedAt: "desc" },
            }),
            sourceUpdatedAtByConcept(orgId, [node.id]),
          ]);
          const ctxMap = await loadVerificationContexts(concept.id, rawPageRows.map((r) => r.id), rawExtRows.map((r) => r.id));
          const childSource = childSources.get(node.id);

          for (const raw of rawPageRows) {
            const withCtx = applyContext(raw, "page", concept.id, ctxMap);
            const mapped = toDependentPage(withCtx, resolveTrust(raw.page.folderId, raw.page.rules), childSource, node.group);
            if (seenPageKey.has(mapped.slug)) continue;
            seenPageKey.add(mapped.slug);
            mergedDependents = [...mergedDependents, mapped];
          }
          for (const raw of rawExtRows) {
            const withCtx = applyContext(raw, "external", concept.id, ctxMap);
            const mapped = toExternalRow(withCtx, childSource, node.group);
            if (seenExtKey.has(mapped.url)) continue;
            seenExtKey.add(mapped.url);
            mergedExternal = [...mergedExternal, mapped];
          }

          if (node.group === node.term) {
            includesOut.push({
              term: node.term,
              kind: node.kind,
              summary: summarize(mergedDependents.filter((d) => d.group === node.term), mergedExternal.filter((e) => e.group === node.term)),
            });
          }

          const grandchildren = await db.conceptInclude.findMany({ where: { parentId: node.id }, select: { child: { select: { id: true, displayName: true, kind: true } } } });
          for (const g of grandchildren) {
            if (!visitedConcepts.has(g.child.id)) nextFrontier.push({ id: g.child.id, term: g.child.displayName, kind: g.child.kind, group: node.group });
          }
        }
        frontier = nextFrontier;
      }
      if (frontier.length > 0) truncated = true;
    }

    return {
      concept: { term: concept.displayName, kind: concept.kind, usageCount: concept.usageCount },
      concepts: [],
      asserters,
      dependents: mergedDependents,
      instances,
      asserterGaps: (mergedDependents.length > 0 || mergedExternal.length > 0) && asserters.length === 0 ? [concept.displayName] : [],
      external: mergedExternal,
      includes: includesOut,
      truncated,
      summary: summarize([...mergedDependents, ...instances], mergedExternal),
    };
  }

  if (opts.slug) {
    const page = await db.page.findUnique({
      where: { orgId_slug: { orgId, slug: opts.slug } },
      select: { id: true, slug: true, title: true },
    });
    if (!page) return empty;

    const own = await db.pageConcept.findMany({
      where: { pageId: page.id },
      include: { concept: true },
    });
    const dependsIds = own.filter((pc) => pc.rel === "depends").map((pc) => pc.conceptId);
    const assertsIds = own.filter((pc) => pc.rel === "asserts").map((pc) => pc.conceptId);

    // A template page is depended on through its template/<slug> concept,
    // which lives on the instances rather than on the template itself.
    const templateConcept = await db.concept.findUnique({
      where: { normalizedName: templateConceptTerm(page.slug) },
      select: { id: true },
    });

    const [asserters, dependents, instances, external] = await Promise.all([
      edges(dependsIds, ["asserts"], page.id),
      edges(assertsIds, ["depends"], page.id),
      templateConcept ? edges([templateConcept.id], ["instantiates"], page.id) : Promise.resolve([] as DependentPage[]),
      externals(assertsIds),
    ]);

    const assertedTerms = new Set(asserters.map((a) => a.via));
    const asserterGaps = own
      .filter((pc) => pc.rel === "depends" && !assertedTerms.has(pc.concept.displayName))
      .map((pc) => pc.concept.displayName);

    return {
      page: { slug: page.slug, title: page.title },
      concepts: own.map((pc) => ({ term: pc.concept.displayName, kind: pc.concept.kind, rel: pc.rel })),
      asserters,
      dependents,
      instances,
      asserterGaps,
      external,
      includes: [],
      truncated: false,
      summary: summarize([...dependents, ...instances], external),
    };
  }

  return empty;
}

export interface ConceptMapRow {
  term: string;
  kind: string;
  /** Pages that assert it; first is shown as "source". */
  sources: Array<{ slug: string; title: string; updatedAt: string }>;
  summary: DependentsSummary;
  /** dependents + external still needing a human: stale, needs update, or never checked. */
  needsLook: number;
  total: number;
}

/**
 * Every concept in the org that something depends on, with its verification
 * roll-up, ranked by how much still needs a human. Backs /map and the
 * dashboard card. One getDependents per concept: fine at tens of concepts,
 * revisit with a grouped query when an org passes a few hundred.
 */
export async function listConceptMaps(orgId: string): Promise<ConceptMapRow[]> {
  const [pageEdges, extEdges] = await Promise.all([
    db.pageConcept.findMany({
      where: { rel: { in: ["depends", "asserts", "instantiates"] }, page: { orgId, status: { not: "archived" } } },
      select: { conceptId: true, concept: { select: { displayName: true, kind: true } } },
      distinct: ["conceptId"],
    }),
    db.externalEdge.findMany({
      where: { asset: { orgId } },
      select: { conceptId: true, concept: { select: { displayName: true, kind: true } } },
      distinct: ["conceptId"],
    }),
  ]);
  const concepts = new Map<string, { term: string; kind: string }>();
  for (const e of [...pageEdges, ...extEdges]) concepts.set(e.conceptId, { term: e.concept.displayName, kind: e.concept.kind });

  const rows: ConceptMapRow[] = [];
  for (const { term, kind } of concepts.values()) {
    const r = await getDependents(orgId, { term });
    const total = r.summary.pages.total + r.summary.external.total;
    if (total === 0 && r.asserters.length === 0) continue;
    const needsLook = total - r.summary.pages.ok - r.summary.external.ok;
    rows.push({
      term,
      kind,
      sources: r.asserters.map((a) => ({ slug: a.slug, title: a.title, updatedAt: a.updatedAt })),
      summary: r.summary,
      needsLook,
      total,
    });
  }
  rows.sort((a, b) => b.needsLook - a.needsLook || b.total - a.total || a.term.localeCompare(b.term));
  return rows;
}
