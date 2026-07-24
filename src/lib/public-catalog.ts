import yaml from "js-yaml";
import { db } from "@/lib/db";

// Catalog of everything anonymous callers can already reach, used by the
// discovery surfaces (robots.txt, sitemap.xml, llms.txt, the agent-skills
// index). It only ever selects visibility=public rows, so nothing here can
// widen access — a page missing from these listings is still reachable, and a
// page present in them was already reachable as HTML.

export interface PublicPageEntry {
  orgSlug: string;
  orgName: string;
  slug: string;
  title: string;
  updatedAt: Date;
}

export interface PublicPageContent extends PublicPageEntry {
  json: Record<string, unknown>;
  contentHash: string;
}

/** Hard ceiling so a large instance cannot turn a discovery route into a scan. */
export const CATALOG_LIMIT = 500;

export async function listPublicPages(limit = CATALOG_LIMIT): Promise<PublicPageEntry[]> {
  const pages = await db.page.findMany({
    where: { visibility: "public", status: { not: "archived" } },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: {
      slug: true,
      title: true,
      updatedAt: true,
      org: { select: { slug: true, name: true } },
    },
  });

  return pages
    .filter((p) => !!p.org?.slug)
    .map((p) => ({
      orgSlug: p.org.slug,
      orgName: p.org.name,
      slug: p.slug,
      title: p.title,
      updatedAt: p.updatedAt,
    }));
}

/**
 * Same listing with each page's latest content attached. Used where the body
 * matters (llms-full.txt, skill digests); pulls one version row per page.
 */
export async function listPublicPageContent(limit = CATALOG_LIMIT): Promise<PublicPageContent[]> {
  const pages = await db.page.findMany({
    where: { visibility: "public", status: { not: "archived" } },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: {
      slug: true,
      title: true,
      updatedAt: true,
      org: { select: { slug: true, name: true } },
      versions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { jsonContent: true, yamlContent: true, contentHash: true },
      },
    },
  });

  return pages.flatMap((p) => {
    const version = p.versions[0];
    if (!version || !p.org?.slug) return [];
    const json = version.jsonContent
      ? (version.jsonContent as Record<string, unknown>)
      : (yaml.load(version.yamlContent) as Record<string, unknown> | undefined);
    if (!json || typeof json !== "object") return [];
    return [
      {
        orgSlug: p.org.slug,
        orgName: p.org.name,
        slug: p.slug,
        title: p.title,
        updatedAt: p.updatedAt,
        json,
        contentHash: version.contentHash,
      },
    ];
  });
}

/** A page is an installable pack when it carries a `pack:` block. */
export function isPack(json: Record<string, unknown>): boolean {
  return !!json.pack && typeof json.pack === "object";
}

/**
 * Absolute origin for the current request. Discovery documents must contain
 * absolute URLs, and the same code serves curata.ai and self-hosted instances.
 */
export function siteOrigin(request: Request): string {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost ?? request.headers.get("host") ?? url.host;
  const proto =
    request.headers.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}
