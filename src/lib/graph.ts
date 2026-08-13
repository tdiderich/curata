import { db } from "./db";
import { DEFAULT_TAGS } from "./default-tags";
import { extractOrgTags } from "./org-tags";

export type TagTier = "default" | "org" | "personal";

export interface GraphTag {
  id: string;
  name: string;
  pages: number;
  tokens: number;
  /**
   * default = curata's canonical starter tags; org = recommended by an
   * owner/admin in settings (the org-tags entry in content rules);
   * personal = everything else. Folder-derived tags resolve through the
   * same ladder by name.
   */
  tier: TagTier;
  /**
   * The backing Concept's kind (topic/vendor/finding/framework or free-form).
   * Empty for folder-only tags and legacy rows — both render as topic.
   */
  conceptKind?: string;
  /** True when at least part of this tag's membership comes from a folder. */
  fromFolder?: boolean;
  /** True when the tag is purely folder-derived — no Concept row backs it, so it has no kind to color by. */
  folderOnly?: boolean;
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

interface PageRow {
  id: string;
  slug: string;
  title: string;
  folder_id: string | null;
  updated_at: Date;
  tokens: bigint;
}

/**
 * The dashboard knowledge graph and the MCP brain map's shared substrate.
 *
 * Tags come from two sources merged by normalized name: explicit concept
 * tags, and the page's folder — putting a page in a Sales folder makes it a
 * member of the sales tag. Folder tags are derived at query time, never
 * materialized: renames propagate instantly and nothing can drift. Direct
 * folder only (no ancestor rollup) for now.
 *
 * Token weights are the same chars/4 estimate everywhere — one substrate,
 * agent TSV and human graph. Untagged = no concept tags AND no folder.
 */
export async function buildKnowledgeGraph(orgId: string): Promise<KnowledgeGraph> {
  const [org, folders, pageRows] = await Promise.all([
    db.organization.findUnique({ where: { id: orgId }, select: { rules: true } }),
    db.folder.findMany({ where: { orgId }, select: { id: true, name: true } }),
    db.$queryRaw<PageRow[]>`
      SELECT p.id, p.slug, p.title, p.folder_id, p.updated_at,
             (LENGTH(pv.yaml_content) / 4)::bigint AS tokens
      FROM pages p
      JOIN LATERAL (
        SELECT yaml_content FROM page_versions
        WHERE page_id = p.id ORDER BY created_at DESC LIMIT 1
      ) pv ON TRUE
      WHERE p.org_id = ${orgId} AND p.status = 'active'
      ORDER BY p.updated_at DESC
    `,
  ]);
  const blessed = new Set(extractOrgTags(org?.rules));
  const defaultNames = new Set<string>(DEFAULT_TAGS);
  const folderName = new Map(folders.map((f) => [f.id, f.name.trim().toLowerCase()]));

  const conceptRows =
    pageRows.length === 0
      ? []
      : await db.pageConcept.findMany({
          where: { pageId: { in: pageRows.map((p) => p.id) } },
          select: { pageId: true, concept: { select: { displayName: true, kind: true } } },
        });
  const conceptsByPage = new Map<string, string[]>();
  const kindByName = new Map<string, string>();
  const conceptNames = new Set<string>();
  for (const row of conceptRows) {
    const name = row.concept.displayName.trim().toLowerCase();
    if (!name) continue;
    conceptNames.add(name);
    if (row.concept.kind && !kindByName.get(name)) kindByName.set(name, row.concept.kind);
    const list = conceptsByPage.get(row.pageId) ?? [];
    if (!list.includes(name)) list.push(name);
    conceptsByPage.set(row.pageId, list);
  }

  // Merge concept + folder membership per tag name.
  interface TagAgg {
    pageIds: Set<string>;
    tokens: number;
    fromFolder: boolean;
  }
  const tagMap = new Map<string, TagAgg>();
  const untagged: UntaggedPage[] = [];
  const taggedPageIds = new Set<string>();

  const addMembership = (name: string, page: PageRow, fromFolder: boolean) => {
    const agg = tagMap.get(name) ?? { pageIds: new Set<string>(), tokens: 0, fromFolder: false };
    if (!agg.pageIds.has(page.id)) {
      agg.pageIds.add(page.id);
      agg.tokens += Number(page.tokens);
    }
    agg.fromFolder = agg.fromFolder || fromFolder;
    tagMap.set(name, agg);
  };

  for (const page of pageRows) {
    const conceptNames = conceptsByPage.get(page.id) ?? [];
    const fName = page.folder_id ? folderName.get(page.folder_id) : undefined;
    for (const name of conceptNames) addMembership(name, page, false);
    if (fName) addMembership(fName, page, true);
    if (conceptNames.length === 0 && !fName) {
      untagged.push({
        id: page.id,
        slug: page.slug,
        title: page.title,
        updatedAt: page.updated_at.toISOString(),
      });
    } else {
      taggedPageIds.add(page.id);
    }
  }

  const tags: GraphTag[] = [...tagMap.entries()]
    .sort((a, b) => b[1].pageIds.size - a[1].pageIds.size || b[1].tokens - a[1].tokens)
    .slice(0, MAX_TAGS)
    .map(([name, agg]) => ({
      id: `tag:${name}`,
      name,
      pages: agg.pageIds.size,
      tokens: agg.tokens,
      tier: defaultNames.has(name) ? "default" : blessed.has(name) ? "org" : "personal",
      conceptKind: kindByName.get(name) || undefined,
      fromFolder: agg.fromFolder || undefined,
      folderOnly: (agg.fromFolder && !conceptNames.has(name)) || undefined,
    }));
  const keptTags = new Map(tags.map((t) => [t.name, t]));

  const pageById = new Map(pageRows.map((p) => [p.id, p]));
  const shownPageIds = [...taggedPageIds].slice(0, MAX_PAGES);
  const shownSet = new Set(shownPageIds);
  const pages: GraphPage[] = shownPageIds.map((id) => {
    const p = pageById.get(id)!;
    return { id: p.id, slug: p.slug, title: p.title };
  });

  const edges: GraphEdge[] = [];
  for (const [name, agg] of tagMap) {
    const tag = keptTags.get(name);
    if (!tag) continue;
    for (const pageId of agg.pageIds) {
      if (shownSet.has(pageId)) edges.push({ tagId: tag.id, pageId });
    }
  }

  const suggestedTags = DEFAULT_TAGS.filter((t) => !tagMap.has(t));

  return { tags, pages, edges, untagged, suggestedTags };
}
