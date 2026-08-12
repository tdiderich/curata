import { db } from "./db";
import { DEFAULT_TAGS } from "./default-tags";

export type TagTier = "default" | "org" | "personal";

export interface GraphTag {
  id: string;
  name: string;
  pages: number;
  tokens: number;
  /**
   * default = curata's canonical starter tags; org = used by multiple people
   * (derived from distinct PageConcept creators until explicit org blessing
   * ships with tag governance); personal = one person's tag so far.
   */
  tier: TagTier;
}

export interface GraphPage {
  id: string;
  slug: string;
  title: string;
}

export interface GraphEdge {
  tagId: string;
  pageId: string;
}

export interface UntaggedPage {
  id: string;
  slug: string;
  title: string;
  updatedAt: string;
}

export interface KnowledgeGraph {
  tags: GraphTag[];
  pages: GraphPage[];
  edges: GraphEdge[];
  untagged: UntaggedPage[];
  suggestedTags: string[];
}

// Caps keep the SVG readable and the payload sane for large brains; the graph
// is an overview, drill-down happens on the pages themselves.
const MAX_TAGS = 60;
const MAX_PAGES = 400;

/**
 * The dashboard knowledge graph: tag nodes weighted by page count and token
 * mass (same chars/4 estimate the MCP brain map uses — one substrate, agent
 * TSV and human graph), page nodes, tag→page edges, plus the untagged queue
 * (pages invisible to agents until tagged) and unused default tags rendered
 * as suggestions.
 */
export async function buildKnowledgeGraph(orgId: string): Promise<KnowledgeGraph> {
  const tagRows = await db.$queryRaw<
    { id: string; name: string; pages: number; tokens: bigint; creators: number }[]
  >`
    SELECT c.id, c.display_name AS name,
           COUNT(DISTINCT p.id)::int AS pages,
           (SUM(LENGTH(pv.yaml_content)) / 4)::bigint AS tokens,
           COUNT(DISTINCT pc.created_by)::int AS creators
    FROM concepts c
    JOIN page_concepts pc ON pc.concept_id = c.id
    JOIN pages p ON p.id = pc.page_id
    JOIN LATERAL (
      SELECT yaml_content FROM page_versions
      WHERE page_id = p.id ORDER BY created_at DESC LIMIT 1
    ) pv ON TRUE
    WHERE p.org_id = ${orgId} AND p.status = 'active'
    GROUP BY c.id, c.display_name
    ORDER BY pages DESC, tokens DESC
    LIMIT ${MAX_TAGS}
  `;
  const defaultNames = new Set<string>(DEFAULT_TAGS);
  const tags: GraphTag[] = tagRows.map((t) => ({
    id: t.id,
    name: t.name,
    pages: t.pages,
    tokens: Number(t.tokens),
    tier: defaultNames.has(t.name.toLowerCase()) ? "default" : t.creators > 1 ? "org" : "personal",
  }));
  const tagIds = tags.map((t) => t.id);

  const taggedPages =
    tagIds.length === 0
      ? []
      : await db.page.findMany({
          where: {
            orgId,
            status: "active",
            concepts: { some: { conceptId: { in: tagIds } } },
          },
          select: {
            id: true,
            slug: true,
            title: true,
            concepts: { select: { conceptId: true }, where: { conceptId: { in: tagIds } } },
          },
          orderBy: { updatedAt: "desc" },
          take: MAX_PAGES,
        });

  const pages: GraphPage[] = taggedPages.map((p) => ({ id: p.id, slug: p.slug, title: p.title }));
  const edges: GraphEdge[] = taggedPages.flatMap((p) =>
    [...new Set(p.concepts.map((c) => c.conceptId))].map((tagId) => ({ tagId, pageId: p.id }))
  );

  const untaggedRows = await db.page.findMany({
    where: { orgId, status: "active", concepts: { none: {} } },
    select: { id: true, slug: true, title: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });
  const untagged: UntaggedPage[] = untaggedRows.map((p) => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    updatedAt: p.updatedAt.toISOString(),
  }));

  const usedNames = new Set(tags.map((t) => t.name.toLowerCase()));
  const suggestedTags = DEFAULT_TAGS.filter((t) => !usedNames.has(t));

  return { tags, pages, edges, untagged, suggestedTags };
}
