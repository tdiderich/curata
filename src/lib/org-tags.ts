// Blessed organization tags live inside the org's global content-rules JSON
// as one reserved entry, so they ride the existing rules storage, API
// permissions (rules:manage), and settings surface instead of a new table.
// Everything that lists prose rules filters this entry out by id.

export const ORG_TAGS_RULE_ID = "org-tags";

interface OrgTagsEntry {
  id: string;
  text: string;
  mode: "warn";
  tags: string[];
}

/** Reads the blessed tag list out of an org's rules JSON. */
export function extractOrgTags(rulesJson: unknown): string[] {
  if (!Array.isArray(rulesJson)) return [];
  const entry = rulesJson.find(
    (r): r is OrgTagsEntry =>
      typeof r === "object" &&
      r !== null &&
      (r as Record<string, unknown>).id === ORG_TAGS_RULE_ID
  );
  if (!entry || !Array.isArray(entry.tags)) return [];
  return entry.tags.filter((t): t is string => typeof t === "string" && !!t);
}

/** Returns a new rules array with the blessed list replaced (or removed when empty). */
export function withOrgTags(rulesJson: unknown, tags: string[]): unknown[] {
  const rules = Array.isArray(rulesJson) ? rulesJson : [];
  const rest = rules.filter(
    (r) => !(typeof r === "object" && r !== null && (r as Record<string, unknown>).id === ORG_TAGS_RULE_ID)
  );
  const cleaned = [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
  if (cleaned.length === 0) return rest;
  return [
    ...rest,
    { id: ORG_TAGS_RULE_ID, text: "Blessed organization tags", mode: "warn", tags: cleaned },
  ];
}
