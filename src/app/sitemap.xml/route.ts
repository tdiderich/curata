import { NextResponse } from "next/server";
import { listPublicPages, siteOrigin } from "@/lib/public-catalog";

// Lists only visibility=public pages. Hand-rolled rather than Next's sitemap.ts
// so the org index pages and the markdown alternates can be expressed directly.

export const dynamic = "force-dynamic";

const escape = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

export async function GET(request: Request) {
  const origin = siteOrigin(request);
  const pages = await listPublicPages();

  const orgSlugs = [...new Set(pages.map((p) => p.orgSlug))];

  const entries = [
    { loc: `${origin}/`, lastmod: undefined as string | undefined },
    ...orgSlugs.map((slug) => ({ loc: `${origin}/p/${slug}`, lastmod: undefined })),
    ...pages.map((p) => ({
      loc: `${origin}/p/${p.orgSlug}/${p.slug}`,
      lastmod: p.updatedAt.toISOString(),
    })),
  ];

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...entries.map((e) => {
      const parts = [`  <url>`, `    <loc>${escape(e.loc)}</loc>`];
      if (e.lastmod) parts.push(`    <lastmod>${e.lastmod}</lastmod>`);
      if (e.lastmod) {
        parts.push(
          `    <xhtml:link rel="alternate" type="text/markdown" href="${escape(`${e.loc}.md`)}"/>`,
        );
      }
      parts.push(`  </url>`);
      return parts.join("\n");
    }),
    "</urlset>",
    "",
  ];

  return new NextResponse(body.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=900",
    },
  });
}
