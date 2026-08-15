/**
 * Shared "chars/4" token estimate — the same substrate the dashboard
 * knowledge graph and MCP brain map already use (see buildKnowledgeGraph in
 * graph.ts, which computes the identical truncating ratio in raw SQL for
 * existing pages: `(LENGTH(yaml_content) / 4)::bigint`). Kept as plain
 * integer division here too, not ceil()'d, so a page's stored tokenCount
 * always agrees with what the graph and brain-map endpoints report for the
 * same content.
 */
export function estimateTokens(text: string): number {
  return Math.floor(text.length / 4);
}
