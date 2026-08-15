import { NextResponse } from "next/server";
import { readPage } from "@/lib/pages";
import { pageToMarkdown } from "@/lib/page-markdown";
import { resolvePublicPage, resolvePublicRefViewer } from "@/lib/public-page";
import { expandComponentRefs, expandSlideRefs, renderedRefWrap } from "@/lib/component-refs";

// Markdown representation of a public page. This is the surface an agent wants:
// the YAML at /raw carries component ids and layout that are noise for reading,
// while the HTML needs a browser. Reachable via this path, via a `.md` suffix on
// the page URL, or via `Accept: text/markdown` — the last two are rewritten here
// by middleware.
//
// SECURITY: gated by resolvePublicPage, the same check the HTML view and /raw
// use. Every failure returns an identical 404.
//
// Like the HTML view, `type: ref` shared-component blocks (in both
// `components` and `slides[].components`) are expanded before rendering —
// this route feeds agents pulling markdown, and an unexpanded ref stub would
// be dead weight to them. /raw stays unexpanded on purpose: it serves the
// stored doc as-is.

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

  const viewer = await resolvePublicRefViewer(ref.orgId);
  const refCtx = {
    orgId: ref.orgId,
    channel: "latest" as const,
    viewer: { ...viewer, shareToken },
    ...renderedRefWrap((refSlug: string) => `/p/${orgSlug}/${refSlug}`),
  };
  const expandedComponents = await expandComponentRefs(
    data.json.components as Array<Record<string, unknown>> | undefined,
    refCtx
  );
  const rawSlides = data.json.slides as Array<Record<string, unknown>> | undefined;
  const expandedSlides = Array.isArray(rawSlides) ? await expandSlideRefs(rawSlides, refCtx) : rawSlides;

  const canonical = `${url.origin}/p/${orgSlug}/${pageSlug}`;
  const markdown = pageToMarkdown(
    { ...data.json, components: expandedComponents, slides: expandedSlides },
    { preamble: `<!-- source: ${canonical} -->` }
  );

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
