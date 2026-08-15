// Shared word-frequency extraction used by both capture_thread's dedup pass
// (capture-dedup.ts) and search_pages' term-level fallback (pages.ts). A
// literal-substring match only catches verbatim phrases; a paraphrase shares
// distinctive single words even when no line survives word-for-word.
// Factored out here (rather than one importing the other) so pages.ts and
// capture-dedup.ts, which already import from each other's neighborhood,
// don't grow a cross-import between them.

export const MAX_SALIENT_TERMS = 8;

export const STOPWORDS = new Set([
  "this", "that", "with", "have", "will", "your", "from", "they", "them",
  "there", "their", "what", "when", "where", "which", "would", "could",
  "should", "about", "just", "like", "only", "then", "than", "does", "need",
  "into", "some", "more", "also", "here", "want", "make", "sure", "still",
  "been", "were", "because", "over", "very", "really", "thanks", "hey",
]);

/**
 * Distinctive single words from `content`, ranked by frequency (ties broken
 * by length, longer first) and capped at `max`.
 */
export function extractSalientTerms(content: string, max = MAX_SALIENT_TERMS): string[] {
  const counts = new Map<string, number>();
  for (const raw of content.toLowerCase().split(/[^a-z0-9_-]+/)) {
    const w = raw.trim();
    if (w.length < 4 || STOPWORDS.has(w)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, max)
    .map(([w]) => w);
}
