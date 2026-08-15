import { NextResponse } from "next/server";
import { readPage } from "@/lib/pages";
import { resolvePublicPage, resolvePublicRefViewer } from "@/lib/public-page";
import { buildPagePrompt, promptNote } from "@/lib/share-prompt";
import { siteOrigin } from "@/lib/public-catalog";
import { expandComponentRefs, expandSlideRefs, renderedRefWrap } from "@/lib/component-refs";
import { pageToMarkdown } from "@/lib/page-markdown";

// The share prompt as plain text, so it can be curled or linked, not only copied
// out of the dialog on the page.
//
// SECURITY: same gate as /md and /raw via resolvePublicPage. Carries no
// credentials by construction — it only describes anonymous fetches.
//
// The prompt text itself deliberately links to /md rather than inlining the
// page (see buildPagePrompt: fetched, not pasted, so a long-lived agent
// session always re-reads the current version). But the same "Copy with page
// text" fallback the HTML dialog offers for agents with no fetch tool is
// appended here too — with `type: ref` blocks expanded, same as /md, so an
// agent that only ever hits this one endpoint still never sees a raw ref
// stub.

interface Ctx {
  params: Promise<{ orgSlug: string; pageSlug: string }>;
}

const notFound = () => new NextResponse("not found\n", { status: 404 });

export async function GET(request: Request, { params }: Ctx) {
  const { orgSlug, pageSlug } = await params;
  const shareToken = new URL(request.url).searchParams.get("token") ?? undefined;

  const ref = await resolvePublicPage(orgSlug, pageSlug, shareToken);
  if (!ref) return notFound();

  const data = await readPage(ref.orgId, pageSlug);
  if (!data) return notFound();

  const pack = data.json.pack as Record<string, unknown> | undefined;
  const packName = typeof pack?.name === "string" ? pack.name : pack ? pageSlug : undefined;

  const prompt = buildPagePrompt({
    baseUrl: siteOrigin(request),
    orgSlug,
    pageSlug,
    title: (data.json.title as string) || pageSlug,
    description: (data.json.subtitle as string) || undefined,
    packName,
    note: promptNote(data.json),
  });

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
  const markdown = pageToMarkdown({ ...data.json, components: expandedComponents, slides: expandedSlides });

  const full = `${prompt}\n---\n\nThe page content, in case you cannot fetch it:\n\n${markdown}`;

  return new NextResponse(full, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
