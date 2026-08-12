import { db } from "./db";

interface TagRow {
  tag: string;
  pages: number;
  tokens: bigint;
  sample: string[];
}

const MAP_TAG_LIMIT = 15;

/**
 * Assembles the MCP server `instructions` sent to every client at initialize.
 * Three layers, all derived - nothing here is hand-maintained per org:
 *
 * 1. Base behavior: when to search the brain, when to propose a capture.
 * 2. Brain map: tag anatomy computed live from the concept graph - page count,
 *    token cost of pulling the whole tag, sample titles. Tagged content only,
 *    so tagging is what makes knowledge discoverable to agents.
 * 3. Org rules: the text of org-scoped content rules (the same rules enforced
 *    at write time), so agents learn guardrails before a write bounces.
 *
 * Token cost is estimated at chars/4 over each page's current version, so the
 * map is always fresh and needs no stored counters.
 */
export async function buildServerInstructions(
  orgId: string,
  orgSlug: string
): Promise<string> {
  const sections: string[] = [
    `curata knowledge brain for "${orgSlug}". Pages here are validated organizational knowledge: approved customer answers, how-things-work explanations, best practices - captured from real work and human-reviewed.`,
    `WHEN TO SEARCH: before answering anything specific to this organization (its product, customers, pricing, internals, process), call search_pages first - an approved answer may already exist and it outranks your general knowledge. Use the brain map below to judge what is likely covered.`,
    `WHEN TO CAPTURE: when the user validates an answer worth keeping, or asks to save knowledge, search for duplicates first, then create_page (new) or patch_page (update). Writes are validated against org rules and typed-page requirements; a blocked write cites the rule that stopped it. Check list_rules before writing into an unfamiliar folder.`,
  ];

  try {
    const [tags, totals] = await Promise.all([
      db.$queryRaw<TagRow[]>`
        SELECT c.display_name AS tag,
               COUNT(DISTINCT p.id)::int AS pages,
               (SUM(LENGTH(pv.yaml_content)) / 4)::bigint AS tokens,
               (ARRAY_AGG(DISTINCT p.title))[1:3] AS sample
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
        LIMIT ${MAP_TAG_LIMIT}
      `,
      db.$queryRaw<{ count: number }[]>`
        SELECT COUNT(DISTINCT pc.concept_id)::int AS count
        FROM page_concepts pc
        JOIN pages p ON p.id = pc.page_id
        WHERE p.org_id = ${orgId} AND p.status = 'active'
      `,
    ]);

    if (tags.length > 0) {
      const rows = tags.map(
        (t) =>
          `${t.tag}\t${t.pages}\t${Number(t.tokens)}\t${t.sample
            .slice(0, 3)
            .map((s) => `"${s}"`)
            .join(", ")}`
      );
      const total = totals[0]?.count ?? tags.length;
      const overflow =
        total > tags.length
          ? `\n…and ${total - tags.length} more tags - get_vocabulary for the full list.`
          : "";
      sections.push(
        `BRAIN MAP (tagged content only; tokens = cost of pulling every page under the tag):\ntag\tpages\ttokens\tsample\n${rows.join("\n")}${overflow}\nDrill down: get_related <concept> for pages under a tag, list_folders for structure, get_semantic_map for the full graph.`
      );
    }
  } catch {
    // The map is an enhancement - a failed query must never block connect.
  }

  try {
    const org = await db.organization.findUnique({
      where: { id: orgId },
      select: { rules: true },
    });
    const rules = Array.isArray(org?.rules) ? org.rules : [];
    const texts = rules
      .map((r) =>
        typeof r === "object" && r !== null && typeof (r as Record<string, unknown>).text === "string"
          ? ((r as Record<string, unknown>).text as string)
          : null
      )
      .filter((t): t is string => !!t)
      .slice(0, 10);
    if (texts.length > 0) {
      sections.push(
        `ORG RULES (enforced on every write; folder/page scopes add more - list_rules shows the cascade):\n${texts.map((t) => `- ${t}`).join("\n")}`
      );
    }
  } catch {
    // Same: rules surfacing is best-effort.
  }

  return sections.join("\n\n");
}
