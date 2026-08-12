/**
 * Canonical starter tags every org's brain suggests. Not enforced — tagging
 * stays freeform (org-level restriction is a rules concern) — but surfaced in
 * two places so usage converges instead of drifting into synonyms:
 * agents see them in the MCP server instructions when capturing, and the
 * dashboard graph shows unused ones as dimmed "suggested" nodes.
 *
 * Combining tags is the point: a page tagged engineering + go-to-market is
 * something engineers should know that customers will also ask about.
 */
export const DEFAULT_TAGS = [
  "skill",
  "faq",
  "how-it-works",
  "customers",
  "sales",
  "go-to-market",
  "engineering",
  "hr",
] as const;
