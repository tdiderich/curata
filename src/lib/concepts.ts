import { db } from "./db";
import { CONCEPT_KINDS } from "./concept-kinds";
import { Prisma } from "@/generated/prisma/client";

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

export async function upsertConcepts(
  pageId: string,
  concepts: ConceptInput[],
  createdBy: string
): Promise<void> {
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

    let concept;
    if (existing) {
      // Also migrates a legacy multi-word row to the slug form the first
      // time it's touched, so it stops needing this fallback afterward.
      concept = await db.concept.update({
        where: { id: existing.id },
        data: {
          normalizedName: normalized,
          displayName: normalized,
          kind: c.kind || undefined,
          updatedAt: new Date(),
        },
      });
    } else {
      try {
        concept = await db.concept.create({
          data: { normalizedName: normalized, displayName: normalized, kind: c.kind || "", usageCount: 1 },
        });
      } catch (err) {
        // Two concurrent writers can both miss the lookup above and race to
        // create the same slug; the loser falls back to the row the winner
        // just created instead of surfacing a constraint error.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          concept = await db.concept.update({
            where: { normalizedName: normalized },
            data: { kind: c.kind || undefined, updatedAt: new Date() },
          });
        } else {
          throw err;
        }
      }
    }

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
}

type PageConceptWithPage = {
  rel: string;
  concept: { displayName: string; kind: string; usageCount: number };
  page: {
    slug: string;
    title: string;
    folderId: string | null;
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
      trustedVersionId: true,
      updatedAt: true,
      versions: { orderBy: { createdAt: "desc" as const }, take: 1, select: { id: true } },
    },
  },
};

function toDependentPage(row: PageConceptWithPage): DependentPage {
  const latestId = row.page.versions[0]?.id ?? null;
  const trusted = !!row.page.trustedVersionId;
  return {
    slug: row.page.slug,
    title: row.page.title,
    folderId: row.page.folderId,
    rel: row.rel,
    via: row.concept.displayName,
    trusted,
    trustedBehind: trusted && latestId !== null && row.page.trustedVersionId !== latestId,
    updatedAt: row.page.updatedAt.toISOString(),
  };
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
  const empty: DependentsResult = { concepts: [], asserters: [], dependents: [], instances: [], asserterGaps: [] };
  const pageScope = { orgId, status: { not: "archived" } };

  async function edges(conceptIds: string[], rels: ConceptRel[], excludePageId?: string): Promise<DependentPage[]> {
    if (conceptIds.length === 0) return [];
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
    return rows.map(toDependentPage);
  }

  if (opts.term) {
    const normalized = normalizeTerm(opts.term);
    const concept = await findConceptForTerm(opts.term, normalized);
    if (!concept) return empty;
    const filter = (r: ConceptRel) => !opts.rel || opts.rel === r;
    const [asserters, dependents, instances] = await Promise.all([
      filter("asserts") ? edges([concept.id], ["asserts"]) : [],
      filter("depends") ? edges([concept.id], ["depends"]) : [],
      filter("instantiates") ? edges([concept.id], ["instantiates"]) : [],
    ]);
    return {
      concept: { term: concept.displayName, kind: concept.kind, usageCount: concept.usageCount },
      concepts: [],
      asserters,
      dependents,
      instances,
      asserterGaps: dependents.length > 0 && asserters.length === 0 ? [concept.displayName] : [],
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

    const [asserters, dependents, instances] = await Promise.all([
      edges(dependsIds, ["asserts"], page.id),
      edges(assertsIds, ["depends"], page.id),
      templateConcept ? edges([templateConcept.id], ["instantiates"], page.id) : Promise.resolve([] as DependentPage[]),
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
    };
  }

  return empty;
}
