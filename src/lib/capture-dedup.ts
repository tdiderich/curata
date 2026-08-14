import { loadSearchIndex } from "@/lib/pages";
import type { SearchIndexEntry } from "@/lib/pages";
import { hasDashboardBlock } from "@/lib/glance-prompts";
import { getVocabulary, getRelated } from "@/lib/concepts";

export interface CaptureDedupCandidate {
  slug: string;
  title: string;
  snippet: string;
  whyMatched: string;
}

const MAX_PHRASES = 5;
const MAX_CONCEPT_TERMS = 5;
const MAX_CANDIDATES = 8;
const MAX_SALIENT_TERMS = 8;
// A page must share at least this many distinct salient terms with the
// thread before a term-level hit counts as a dedup candidate — one shared
// word is noise, two or more starts to look like the same topic.
const MIN_TERM_HITS = 2;

const STOPWORDS = new Set([
  "this", "that", "with", "have", "will", "your", "from", "they", "them",
  "there", "their", "what", "when", "where", "which", "would", "could",
  "should", "about", "just", "like", "only", "then", "than", "does", "need",
  "into", "some", "more", "also", "here", "want", "make", "sure", "still",
  "been", "were", "because", "over", "very", "really", "thanks", "hey",
]);

/**
 * Distinctive single words from the thread, for term-level search.
 * A literal-substring match only catches verbatim copies — paraphrased
 * near-duplicates (the common case) surface through shared distinctive
 * terms instead.
 */
function extractSalientTerms(content: string, max = MAX_SALIENT_TERMS): string[] {
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

/**
 * Pulls a handful of the longest, most specific lines out of a raw
 * thread/transcript to use as search queries. Matching is on literal
 * substrings (see matchEntry below), so a near-duplicate capture — the exact
 * signal dedup cares about — tends to share one of these lines close to
 * verbatim even when the rest of the thread text differs.
 */
function extractSalientPhrases(content: string, max = MAX_PHRASES): string[] {
  const lines = content
    .split(/\r?\n+/)
    .map((l) => l.replace(/^[\s>*\-\d.)]+/, "").trim())
    .filter((l) => l.length >= 12 && /[a-zA-Z]/.test(l));

  const seen = new Set<string>();
  const phrases: string[] = [];
  for (const line of [...lines].sort((a, b) => b.length - a.length)) {
    const truncated = line.length > 140 ? line.slice(0, 140) : line;
    const key = truncated.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    phrases.push(truncated);
    if (phrases.length >= max) break;
  }
  return phrases;
}

function wordMatch(content: string, term: string): boolean {
  if (!term) return false;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    return new RegExp(`\\b${escaped}\\b`, "i").test(content);
  } catch {
    return false;
  }
}

/**
 * Literal-substring match of `q` against one page's title/content, mirroring
 * searchPages' matching + snippet-selection logic exactly (including its
 * dashboard-block title/description fallback) so switching from N
 * searchPages calls to one in-memory pass over a pre-loaded index doesn't
 * change which pages match or what snippet/title gets surfaced.
 */
function matchEntry(entry: SearchIndexEntry, q: string): { title: string; snippet: string } | null {
  const titleMatch = entry.title.toLowerCase().includes(q);
  const contentMatch = entry.content.toLowerCase().includes(q);
  if (!titleMatch && !contentMatch) return null;

  const lines = entry.content.split("\n");
  const lineMatches = lines
    .filter((l) => l.toLowerCase().includes(q))
    .slice(0, 5)
    .map((l) => l.trim());

  const isDashboard = entry.dashboardEnabled && entry.json && hasDashboardBlock(entry.json);
  const dashBlock = isDashboard ? (entry.json!.dashboard as { title?: string; description?: string }) : null;

  const matches = titleMatch && lineMatches.length === 0 ? [dashBlock?.description ?? entry.title] : lineMatches;
  return { title: dashBlock?.title ?? entry.title, snippet: matches[0] ?? "" };
}

/**
 * capture_thread's dedup surface: full-text search over salient phrases from
 * the thread, plus concept-graph relatedness for any known vocabulary terms
 * that appear in it. Simple on purpose — the point is giving the agent
 * enough to eyeball before it commits to "new", not a ranked relevance
 * engine.
 *
 * Loads the org's searchable page set once (loadSearchIndex) and matches
 * every phrase/term against that in-memory set in a single pass, rather than
 * issuing a fresh full-org query per phrase/term (up to MAX_PHRASES +
 * MAX_SALIENT_TERMS = 13 DB round trips previously).
 */
export async function findCaptureDedupCandidates(
  orgId: string,
  content: string,
  userId?: string
): Promise<CaptureDedupCandidate[]> {
  const bySlug = new Map<string, CaptureDedupCandidate>();
  const index = await loadSearchIndex(orgId, userId, "latest");

  const phrases = extractSalientPhrases(content);
  for (const phrase of phrases) {
    const q = phrase.toLowerCase();
    for (const entry of index) {
      if (bySlug.has(entry.slug)) continue;
      const hit = matchEntry(entry, q);
      if (!hit) continue;
      const shown = phrase.length > 60 ? `${phrase.slice(0, 60)}…` : phrase;
      bySlug.set(entry.slug, {
        slug: entry.slug,
        title: hit.title,
        snippet: hit.snippet,
        whyMatched: `full-text match: "${shown}"`,
      });
    }
  }

  // Term-level pass: paraphrased duplicates share distinctive words even
  // when no full line survives verbatim. Score pages by how many distinct
  // salient terms they match and keep the ones above the noise floor.
  const terms = extractSalientTerms(content);
  const termHits = new Map<string, { title: string; snippet: string; matched: string[] }>();
  for (const term of terms) {
    const q = term.toLowerCase();
    for (const entry of index) {
      if (bySlug.has(entry.slug)) continue;
      const hit = matchEntry(entry, q);
      if (!hit) continue;
      const existing = termHits.get(entry.slug) ?? { title: hit.title, snippet: hit.snippet, matched: [] };
      existing.matched.push(term);
      termHits.set(entry.slug, existing);
    }
  }
  const scored = [...termHits.entries()]
    .filter(([, h]) => h.matched.length >= MIN_TERM_HITS)
    .sort((a, b) => b[1].matched.length - a[1].matched.length);
  for (const [slug, h] of scored) {
    if (bySlug.has(slug)) continue;
    bySlug.set(slug, {
      slug,
      title: h.title,
      snippet: h.snippet,
      whyMatched: `shared terms: ${h.matched.join(", ")}`,
    });
  }

  try {
    const { concepts } = await getVocabulary();
    const matchedTerms = concepts.filter((c) => wordMatch(content, c.term)).slice(0, MAX_CONCEPT_TERMS);
    for (const c of matchedTerms) {
      const related = await getRelated(orgId, { term: c.term });
      for (const p of related.pages) {
        if (bySlug.has(p.slug)) continue;
        bySlug.set(p.slug, {
          slug: p.slug,
          title: p.title,
          snippet: `shares concept(s): ${p.sharedConcepts.join(", ")}`,
          whyMatched: `concept graph: "${c.term}"`,
        });
      }
    }
  } catch {
    // Concept relatedness is an enhancement over full-text search — a failed
    // vocabulary lookup must never block capture_thread from returning.
  }

  return [...bySlug.values()].slice(0, MAX_CANDIDATES);
}
