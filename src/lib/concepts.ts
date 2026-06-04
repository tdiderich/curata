import { db } from "./db";

export interface ConceptInput {
  term: string;
  kind?: string;
  section?: string;
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

export function normalizeTerm(term: string): string {
  return term.toLowerCase().trim().replace(/\s+/g, " ");
}

export async function upsertConcepts(
  pageId: string,
  concepts: ConceptInput[],
  createdBy: string
): Promise<void> {
  for (const c of concepts) {
    const normalized = normalizeTerm(c.term);
    if (!normalized) continue;

    const concept = await db.concept.upsert({
      where: { normalizedName: normalized },
      create: {
        normalizedName: normalized,
        displayName: c.term.trim(),
        kind: c.kind || "",
        usageCount: 1,
      },
      update: {
        kind: c.kind || undefined,
        updatedAt: new Date(),
      },
    });

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
  for (const link of links) {
    const targetPage = await db.page.findUnique({
      where: { orgId_slug: { orgId, slug: link.target } },
    });
    if (!targetPage) continue;

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
    kinds: allKinds.map((k) => k.kind),
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
        pages: { include: { page: true } },
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
      where: { OR: [{ fromPageId: page.id }, { toPageId: page.id }] },
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
