import { db } from "./db";
import {
  componentConceptTerm,
  ensureConcept,
  findConceptForTerm,
  normalizeExternalUrl,
  normalizeTerm,
} from "./concepts";

/**
 * Write-path scan: the free edges. Every page write walks the stored
 * document once and records two things nobody had to tag:
 *
 * - `embeds`: a `type: ref` block (or a section with a slug) means this page
 *   depends on that component page. Written as a PageConcept edge on the
 *   concept `component/<slug>`, rel `embeds`, so it rides the same
 *   verification and chart plumbing as a hand-tagged `depends`.
 * - external refs: every absolute http(s) URL in any string on the page
 *   becomes one ExternalAsset per normalized URL plus an ExternalRef row per
 *   page. That's the inventory. It's not scope: nothing gets flagged because
 *   a page mentions a URL. Scope (ExternalEdge) is still declared.
 *
 * Both sets are replaced wholesale per write, so an edge that stops being
 * true when a ref block is deleted goes away on the next save.
 */

type Comp = Record<string, unknown>;

/** Hosts nobody wants in an inventory. Merged with the org's own list. */
export const DEFAULT_IGNORED_DOMAINS: readonly string[] = [
  "slack.com",
  "giphy.com",
  "calendly.com",
  "zoom.us",
  "loom.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "localhost",
];

const URL_RE = /https?:\/\/[^\s<>"'`)\]}]+/g;

function walkStrings(node: unknown, out: string[]): void {
  if (typeof node === "string") { out.push(node); return; }
  if (Array.isArray(node)) { for (const n of node) walkStrings(n, out); return; }
  if (node && typeof node === "object") for (const v of Object.values(node as Comp)) walkStrings(v, out);
}

/** Slugs this document embeds via ref blocks or slugged sections, at any depth. */
export function extractEmbeddedSlugs(doc: unknown): string[] {
  const out = new Set<string>();
  const visit = (node: unknown) => {
    if (Array.isArray(node)) { for (const n of node) visit(n); return; }
    if (!node || typeof node !== "object") return;
    const c = node as Comp;
    const slug = typeof c.slug === "string" ? c.slug.trim() : "";
    if ((c.type === "ref" || c.type === "section") && slug) out.add(slug);
    for (const v of Object.values(c)) if (v && typeof v === "object") visit(v);
  };
  visit(doc);
  return [...out];
}

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function isIgnored(url: string, ignored: readonly string[]): boolean {
  let host: string;
  try { host = new URL(url).host.toLowerCase().replace(/^www\./, ""); } catch { return true; }
  return ignored.some((d) => hostMatches(host, d.toLowerCase().replace(/^www\./, "")));
}

/** Normalized, deduped, non-ignored external URLs in this document. Trailing punctuation a URL picked up from prose is trimmed. */
export function extractExternalUrls(doc: unknown, ignoredDomains: readonly string[] = []): string[] {
  const strings: string[] = [];
  walkStrings(doc, strings);
  const ignored = [...DEFAULT_IGNORED_DOMAINS, ...ignoredDomains];
  const out = new Set<string>();
  for (const s of strings) {
    for (const raw of s.match(URL_RE) ?? []) {
      const trimmed = raw.replace(/[.,;:!?]+$/, "");
      let normalized: string;
      try { normalized = normalizeExternalUrl(trimmed); } catch { continue; }
      if (isIgnored(normalized, ignored)) continue;
      out.add(normalized);
    }
  }
  return [...out];
}

/** Readable default label for an asset nobody has named: host plus the last meaningful path segment. */
export function defaultAssetLabel(url: string): string {
  try {
    const u = new URL(url);
    const host = u.host.replace(/^www\./, "");
    const seg = u.pathname.split("/").filter(Boolean).filter((p) => !/^(d|edit|view|document|spreadsheets|presentation|file)$/.test(p)).pop();
    return seg ? `${host} · ${decodeURIComponent(seg).slice(0, 60)}` : host;
  } catch { return url; }
}

export interface ScanResult {
  embeds: string[];
  externalUrls: string[];
  newExternalUrls: string[];
}

/**
 * Replace this page's system-written `embeds` edges and its ExternalRef
 * rows with what the document says now. Returns what it found so the write
 * response can echo it back to the agent.
 */
export async function syncPageScan(orgId: string, pageId: string, doc: unknown, createdBy: string): Promise<ScanResult> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { ignoredDomains: true } });
  const ignored = org?.ignoredDomains ?? [];

  const embeds = extractEmbeddedSlugs(doc);
  const wantConceptIds = new Set<string>();
  for (const slug of embeds) {
    const term = componentConceptTerm(slug);
    const normalized = normalizeTerm(term);
    const concept = await ensureConcept(term, normalized, await findConceptForTerm(term, normalized), "component");
    wantConceptIds.add(concept.id);
    await db.pageConcept.upsert({
      where: { pageId_conceptId_section: { pageId, conceptId: concept.id, section: "" } },
      create: { pageId, conceptId: concept.id, section: "", rel: "embeds", createdBy, verifiedAt: new Date() },
      update: {},
    });
  }
  await db.pageConcept.deleteMany({ where: { pageId, rel: "embeds", conceptId: { notIn: [...wantConceptIds] } } });

  const externalUrls = extractExternalUrls(doc, ignored);
  const existingRefs = await db.externalRef.findMany({ where: { pageId }, select: { id: true, asset: { select: { url: true } } } });
  const had = new Set(existingRefs.map((r) => r.asset.url));
  const wantAssetIds = new Set<string>();
  const newExternalUrls: string[] = [];
  for (const url of externalUrls) {
    const asset = await db.externalAsset.upsert({
      where: { orgId_url: { orgId, url } },
      create: { orgId, url, label: defaultAssetLabel(url), createdBy },
      update: {},
      select: { id: true },
    });
    wantAssetIds.add(asset.id);
    if (!had.has(url)) newExternalUrls.push(url);
    await db.externalRef.upsert({
      where: { pageId_assetId: { pageId, assetId: asset.id } },
      create: { pageId, assetId: asset.id },
      update: {},
    });
  }
  await db.externalRef.deleteMany({ where: { pageId, assetId: { notIn: [...wantAssetIds] } } });

  return { embeds, externalUrls, newExternalUrls };
}
