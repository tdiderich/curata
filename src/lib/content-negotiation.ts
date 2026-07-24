// Picks the representation of a public page to serve: HTML for browsers,
// markdown or YAML for agents. Kept as pure functions so the rules are testable
// without a running edge runtime.

export const PUBLIC_PAGE_PATH = /^\/p\/([^/]+)\/([^/]+)$/;

const MARKDOWN_TYPES = ["text/markdown", "text/x-markdown"];
const YAML_TYPES = ["application/yaml", "text/yaml", "application/x-yaml", "text/x-yaml"];
const HTML_TYPES = ["text/html", "application/xhtml+xml"];

/**
 * Highest q-value among explicitly named candidate types in an Accept header.
 * Wildcards are ignored on purpose: `*\/*` from curl or a generic HTTP client
 * must keep getting HTML.
 */
export function preferredType(accept: string | null | undefined, candidates: string[]): number {
  if (!accept) return 0;
  let best = 0;
  for (const part of accept.split(",")) {
    const [rawType, ...paramParts] = part.trim().split(";");
    const type = rawType.trim().toLowerCase();
    if (!candidates.includes(type)) continue;
    const qParam = paramParts.map((p) => p.trim()).find((p) => p.startsWith("q="));
    const q = qParam ? Number.parseFloat(qParam.slice(2)) : 1;
    if (Number.isFinite(q) && q > best) best = q;
  }
  return best;
}

/**
 * Target pathname for a request to a public page, or null to serve HTML.
 *
 * Resolves in this order: an explicit `.md` / `.yaml` suffix on the slug wins,
 * then an Accept header that names markdown or YAML above HTML.
 */
export function negotiateTarget(pathname: string, accept?: string | null): string | null {
  const match = PUBLIC_PAGE_PATH.exec(pathname);
  if (!match) return null;
  const [, orgSlug, rawSlug] = match;

  const suffix = /^(.+)\.(md|markdown|yaml|yml)$/i.exec(rawSlug);
  if (suffix) {
    const [, slug, ext] = suffix;
    const kind = ext.toLowerCase().startsWith("y") ? "raw" : "md";
    return `/p/${orgSlug}/${slug}/${kind}`;
  }

  const html = preferredType(accept, HTML_TYPES);
  const markdown = preferredType(accept, MARKDOWN_TYPES);
  const yamlType = preferredType(accept, YAML_TYPES);
  if (markdown === 0 && yamlType === 0) return null;
  if (html >= Math.max(markdown, yamlType)) return null;

  return `/p/${orgSlug}/${rawSlug}/${markdown >= yamlType ? "md" : "raw"}`;
}
