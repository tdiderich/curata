import { loadSearchIndex } from "@/lib/pages";
import type { SearchIndexEntry } from "@/lib/pages";
import { hasDashboardBlock } from "@/lib/glance-prompts";
import { getVocabulary, getRelated } from "@/lib/concepts";
import { extractSalientTerms } from "@/lib/salient-terms";

export interface CaptureDedupCandidate {
  slug: string;
  title: string;
  snippet: string;
  whyMatched: string;
}

const MAX_PHRASES = 5;
const MAX_CONCEPT_TERMS = 5;
const MAX_CANDIDATES = 8;
// A page must share at least this many distinct salient terms with the
// thread before a term-level hit counts as a dedup candidate — one shared
// word is noise, two or more starts to look like the same topic. This is a
// floor: corpusMinTermHits below raises it further on larger corpora, where
// two shared generic words (customer, instance, credential) stop meaning
// anything.
const MIN_TERM_HITS = 2;

// A term that shows up in a large fraction of the org's pages carries no
// dedup signal in a sales-heavy corpus every page says "customer" and
// "instance". Document frequency (fraction of indexed pages containing the
// term) lets common-but-generic vocabulary get down-weighted instead of
// contributing a full point toward MIN_TERM_HITS the same as a rare, truly
// distinctive term.
//
// - DF at or above this fraction: the term is dropped entirely (pure noise).
// - Otherwise the term's weight scales down linearly from 1.0 (rare) to a
//   floor as DF climbs toward the drop threshold, so "somewhat common" terms
//   still count, just for less than a full hit.
const TERM_DROP_DF = 0.4;
const TERM_MIN_WEIGHT = 0.25;

/** How many indexed pages contain `term` (case-insensitive substring). */
function documentFrequency(term: string, index: SearchIndexEntry[]): number {
  let n = 0;
  for (const entry of index) {
    if (entry.content.toLowerCase().includes(term) || entry.title.toLowerCase().includes(term)) n++;
  }
  return index.length > 0 ? n / index.length : 0;
}

/**
 * Rarity weight for a term against this org's corpus: 1.0 for a term unique
 * (or near-unique) to a handful of pages, scaling down to TERM_MIN_WEIGHT as
 * its document frequency approaches TERM_DROP_DF, and 0 (dropped) beyond it.
 */
function termWeight(df: number): number {
  if (df >= TERM_DROP_DF) return 0;
  const scaled = 1 - df / TERM_DROP_DF;
  return TERM_MIN_WEIGHT + (1 - TERM_MIN_WEIGHT) * scaled;
}

/**
 * Effective MIN_TERM_HITS floor, raised as the corpus grows: a two-word
 * overlap is plausible signal on a 20-page brain and pure noise on a
 * 200-page one, where any two generic words co-occur on dozens of pages.
 */
function corpusMinTermHits(pageCount: number): number {
  if (pageCount >= 200) return 4;
  if (pageCount >= 80) return 3;
  return MIN_TERM_HITS;
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
  // when no full line survives verbatim. Each term is weighted by how rare
  // it is across this org's corpus (documentFrequency/termWeight above) —
  // "customer", "instance", "credential" show up on nearly every page of a
  // sales-heavy brain and shouldn't move the needle the same as a term that
  // appears on two pages. Pages are scored by the sum of weighted hits and
  // must clear both an absolute floor (at least 2 distinct terms — one
  // shared word is always noise) and a bar that rises with corpus size
  // (corpusMinTermHits), so a bigger brain requires more/rarer overlap
  // before a term-level hit counts as a candidate at all. Fewer, better
  // candidates beats a wall of generic-vocabulary noise; an empty result is
  // a perfectly fine answer.
  const terms = extractSalientTerms(content);
  const termWeights = new Map<string, number>();
  for (const term of terms) {
    termWeights.set(term, termWeight(documentFrequency(term.toLowerCase(), index)));
  }
  const termHits = new Map<string, { title: string; snippet: string; matched: string[]; score: number }>();
  for (const term of terms) {
    const weight = termWeights.get(term) ?? 0;
    if (weight <= 0) continue; // term is common enough across the corpus to carry no signal
    const q = term.toLowerCase();
    for (const entry of index) {
      if (bySlug.has(entry.slug)) continue;
      const hit = matchEntry(entry, q);
      if (!hit) continue;
      const existing = termHits.get(entry.slug) ?? { title: hit.title, snippet: hit.snippet, matched: [], score: 0 };
      existing.matched.push(term);
      existing.score += weight;
      termHits.set(entry.slug, existing);
    }
  }
  const minHits = corpusMinTermHits(index.length);
  const scored = [...termHits.entries()]
    .filter(([, h]) => h.matched.length >= MIN_TERM_HITS && h.score >= minHits)
    .sort((a, b) => b[1].score - a[1].score);
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
