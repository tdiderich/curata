import { NextResponse } from "next/server";
import { readPage } from "@/lib/pages";
import { pageToMarkdown } from "@/lib/page-markdown";
import { resolvePublicPage } from "@/lib/public-page";

// Markdown representation of a public page. This is the surface an agent wants:
// the YAML at /raw carries component ids and layout that are noise for reading,
// while the HTML needs a browser. Reachable via this path, via a `.md` suffix on
// the page URL, or via `Accept: text/markdown` — the last two are rewritten here
// by middleware.
//
// SECURITY: gated by resolvePublicPage, the same check the HTML view and /raw
// use. Every failure returns an identical 404.

interface Ctx {
  params: Promise<{ orgSlug: string; pageSlug: string }>;
}

const notFound = () => new NextResponse("not found\n", { status: 404 });

export async function GET(request: Request, { params }: Ctx) {
  const { orgSlug, pageSlug } = await params;
  const url = new URL(request.url);
  const shareToken = url.searchParams.get("token") ?? undefined;

  const ref = await resolvePublicPage(orgSlug, pageSlug, shareToken);
  if (!ref) return notFound();

  const data = await readPage(ref.orgId, pageSlug);
  if (!data) return notFound();

  const canonical = `${url.origin}/p/${orgSlug}/${pageSlug}`;
  const markdown = pageToMarkdown(data.json, {
    preamble: `<!-- source: ${canonical} -->`,
  });

  return new NextResponse(markdown, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "X-Content-Hash": data.contentHash,
      "Cache-Control": "no-store",
      Link: `<${canonical}>; rel="canonical"`,
    },
  });
}
