import { NextResponse } from "next/server";
import { readPage } from "@/lib/pages";
import { resolvePublicPage } from "@/lib/public-page";
import { buildPagePrompt } from "@/lib/share-prompt";
import { siteOrigin } from "@/lib/public-catalog";

// The share prompt as plain text, so it can be curled or linked, not only copied
// out of the dialog on the page.
//
// SECURITY: same gate as /md and /raw via resolvePublicPage. Carries no
// credentials by construction — it only describes anonymous fetches.

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
  });

  return new NextResponse(prompt, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
