import { db } from "./db";
import { DEFAULT_TAGS } from "./default-tags";
import { ORG_TAGS_RULE_ID, extractOrgTags } from "./org-tags";
import { buildKnowledgeGraph } from "./graph";

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
    `TRUST CHANNEL: read_page, search_pages, and list_pages take an optional channel param ("trusted" | "latest"), defaulting to "trusted" - the version a human pinned via markTrusted. If no version has been pinned yet, you still get content (latest, never blocked) but the response carries trusted: false - treat that content as unreviewed and say so if you cite it. trustedBehind: true means a human-approved version exists but newer edits have superseded it; mention that drift if it's relevant. Pass channel: "latest" only when you deliberately want the newest edits regardless of trust.`,
    `WHEN TO CAPTURE: when the user validates an answer worth keeping, or asks to save knowledge, search for duplicates first, then create_page (new) or patch_page (update). Writes are validated against org rules and typed-page requirements; a blocked write cites the rule that stopped it. Check list_rules before writing into an unfamiliar folder.`,
    `CAPTURE A RAW THREAD: to save a thread/transcript (not a polished answer you composed), call capture_thread first — it returns dedup_candidates from existing pages, a checklist of what the target pageType requires, and a capture_token. Review the candidates: if one is a near-duplicate, patch_page it instead of creating a new page. Otherwise create_page/write_page with the capture_token plus dedup_ack: "new" (or the candidate slug you decided to update instead, which the server redirects to patch_page). Page types whose required-components rule sets captureRequired: true reject create_page/write_page on a new slug without a valid, unexpired capture_token — capture_thread mints it and it's only good for about 15 minutes. Updates to a page that already exists are never gated this way.`,
    `SKILL PAGES: a page with a skill: marker is an agent procedure - follow its steps; an \`\`\`agl fence is a statically validated flow graph (gates and invariants are binding). Execution semantics: GET /api/docs/agl. Author new skills with the Skill template; broken graphs are rejected at save.`,
    `TAGGING: tag every page you write with concepts - untagged pages are invisible in the brain map. Prefer the canonical tags where they fit (${DEFAULT_TAGS.join(", ")}) plus any specific concepts; combine tags freely - engineering + go-to-market marks something engineers should know that customers will ask about. Reuse existing tags from the brain map over inventing near-synonyms.`,
    `GROUPS: list_groups is read-only for anyone; creating, renaming, deleting groups and adding/removing members (create_group, update_group, delete_group, add_group_member, remove_group_member) only succeed when the calling key belongs to an org owner or admin.`,
    `TRUST FLIPS: mark_trusted and clear_trusted only succeed when the human behind the calling key is eligible under the page's approval rule (owner/admin, or the rule's listed approvers), and every flip is audited — confirm with your human before calling either.`,
    `DIGEST: generate_digest computes new pages, trust flips, pages awaiting review, and hot spots since the last digest run (or the last 7 days, the first time) and writes a dated page to the Digests folder. Run it about weekly, or whenever a human asks what changed. It takes no arguments and is safe to re-run — a second call in the same week updates that week's page instead of creating a duplicate.`,
  ];

  try {
    const graph = await buildKnowledgeGraph(orgId);
    const titleById = new Map(graph.pages.map((p) => [p.id, p.title]));
    const samplesByTag = new Map<string, string[]>();
    for (const e of graph.edges) {
      const list = samplesByTag.get(e.tagId) ?? [];
      const title = titleById.get(e.pageId);
      if (title && list.length < 3) list.push(title);
      samplesByTag.set(e.tagId, list);
    }

    const top = graph.tags.slice(0, MAP_TAG_LIMIT);
    if (top.length > 0) {
      const rows = top.map(
        (t) =>
          `${t.name}\t${t.pages}\t${t.tokens}\t${(samplesByTag.get(t.id) ?? [])
            .map((title) => `"${title}"`)
            .join(", ")}`
      );
      const overflow =
        graph.tags.length > top.length
          ? `\n…and ${graph.tags.length - top.length} more tags - get_vocabulary for the full list.`
          : "";
      sections.push(
        `BRAIN MAP (tagged content - explicit tags and folder membership both count; tokens = cost of pulling every page under the tag):\ntag\tpages\ttokens\tsample\n${rows.join("\n")}${overflow}\nDrill down: get_related <concept> for pages under a tag, list_folders for structure, get_semantic_map for the full graph.`
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
    const blessed = extractOrgTags(org?.rules);
    if (blessed.length > 0) {
      sections.push(
        `ORG TAGS (recommended by this organization's admins - prefer these over inventing near-synonyms): ${blessed.join(", ")}`
      );
    }
    const rules = (Array.isArray(org?.rules) ? org.rules : []).filter(
      (r) => !(typeof r === "object" && r !== null && (r as Record<string, unknown>).id === ORG_TAGS_RULE_ID)
    );
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
