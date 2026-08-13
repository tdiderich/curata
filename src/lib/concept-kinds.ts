/**
 * Curated concept kinds. Like DEFAULT_TAGS this is a suggestion vocabulary,
 * not an enum: Concept.kind stays a free-form string in the schema, and
 * anything outside this list still saves — it just renders with the neutral
 * (topic) treatment in the UI and graph. Surfaced in the tag picker, the
 * knowledge graph legend, and get_vocabulary so usage converges.
 */
export const CONCEPT_KINDS = ["topic", "vendor", "finding", "framework"] as const;

export type ConceptKind = (typeof CONCEPT_KINDS)[number];

/** Kind written when a caller doesn't say otherwise. */
export const DEFAULT_KIND: ConceptKind = "topic";

export function isCuratedKind(kind: string): kind is ConceptKind {
  return (CONCEPT_KINDS as readonly string[]).includes(kind);
}

/**
 * CSS class suffix for a kind's tint. Unknown or empty kinds collapse to the
 * topic treatment so legacy rows (kind: "") need no backfill.
 */
export function kindSlug(kind: string | undefined | null): ConceptKind {
  return kind && isCuratedKind(kind) ? kind : DEFAULT_KIND;
}
