import { db } from "./db";
import { CONCEPT_KINDS } from "./concept-kinds";
import { Prisma } from "@/generated/prisma/client";

export interface ConceptInput {
  term: string;
  kind?: string;
  section?: string;
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
}

export interface LinkOutput {
  target: string;
  rel: string;
  description: string | null;
}

/**
 * Terms are slugs: lowercase letters, digits, and hyphens only. Spaces and
 * underscores convert to hyphens, everything else is stripped, so
 * "Noise Reduction" and "noise-reduction" are the same concept.
 */
export function normalizeTerm(term: string): string {
  return term
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
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

export async function upsertConcepts(
  pageId: string,
  concepts: ConceptInput[],
  createdBy: string
): Promise<void> {
  for (const c of concepts) {
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
        createdBy,
      },
      update: {},
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

  const existing = await db.pageLink.findMany({
    where: { fromPageId },
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
  concepts: Array<{ term: string; kind: string; usageCount: number }>;
  pages: Array<{ slug: string; title: string; sharedConcepts: string[] }>;
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
    pages: Array<{ slug: string; title: string }>;
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
      pages: c.pages.map((pc) => ({ slug: pc.page.slug, title: pc.page.title })),
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
