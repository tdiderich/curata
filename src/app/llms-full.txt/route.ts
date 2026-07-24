import { NextResponse } from "next/server";
import { pageToMarkdown } from "@/lib/page-markdown";
import { listPublicPageContent, siteOrigin } from "@/lib/public-catalog";

// Every public page's markdown in one document, so an agent can read the whole
// public surface in one fetch instead of crawling. Truncates rather than growing
// without bound: an agent that hits the cap can follow the per-page links in
// /llms.txt for the rest.

export const dynamic = "force-dynamic";

const MAX_BYTES = 2_000_000;

export async function GET(request: Request) {
  const origin = siteOrigin(request);
  const pages = await listPublicPageContent();

  const parts = [
    "# curata — full text of all public pages",
    "",
    `Generated ${new Date().toISOString()}. Index: ${origin}/llms.txt`,
    "",
  ];

  let bytes = parts.join("\n").length;
  let truncated = 0;

  for (const page of pages) {
    if (bytes >= MAX_BYTES) {
      truncated += 1;
      continue;
    }
    const url = `${origin}/p/${page.orgSlug}/${page.slug}`;
    const body = pageToMarkdown(page.json, {
      preamble: `---\n\nSource: ${url}\nOrganization: ${page.orgName}\nUpdated: ${page.updatedAt.toISOString()}`,
      titleDepth: 2,
    });
    bytes += body.length;
    parts.push(body);
  }

  if (truncated > 0) {
    parts.push(
      `---\n\n${truncated} further page(s) omitted for length. See ${origin}/llms.txt for the full index.\n`,
    );
  }

  return new NextResponse(parts.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=900",
    },
  });
}
