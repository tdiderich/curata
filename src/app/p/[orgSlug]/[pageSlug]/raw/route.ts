import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readPageYaml } from "@/lib/pages";

// Public raw-YAML endpoint for a page: lets `kazam install` fetch a pack
// anonymously and makes any public page a shareable, tryable artifact. This
// route lives under the public /p/ prefix, so it is reachable without auth.
//
// SECURITY: it must never return YAML for a page the viewer cannot already see
// as HTML. It reuses the exact same gate as the /p/ page view: the page must be
// visibility=public, or a valid share token must resolve via resolvePageAccess.
// Every failure returns an identical 404 so the endpoint leaks no information
// about which private pages exist.

interface Ctx {
  params: Promise<{ orgSlug: string; pageSlug: string }>;
}

const notFound = () => new NextResponse("not found\n", { status: 404 });

export async function GET(request: Request, { params }: Ctx) {
  const { orgSlug, pageSlug } = await params;
  const shareToken = new URL(request.url).searchParams.get("token") ?? undefined;

  const org = await db.organization.findUnique({
    where: { slug: orgSlug },
    select: { id: true },
  });
  if (!org) return notFound();

  const page = await db.page.findUnique({
    where: { orgId_slug: { orgId: org.id, slug: pageSlug } },
    select: { id: true, orgId: true, slug: true, visibility: true, createdBy: true },
  });
  if (!page) return notFound();

  if (page.visibility !== "public") {
    if (!shareToken) return notFound();
    const { resolvePageAccess } = await import("@/lib/access");
    // No user, no org role: an anonymous caller only passes via public
    // visibility (handled above) or a valid share token.
    const access = await resolvePageAccess(page, null, null, shareToken);
    if (!access) return notFound();
  }

  const data = await readPageYaml(org.id, pageSlug);
  if (!data) return notFound();

  return new NextResponse(data.yaml, {
    status: 200,
    headers: {
      "Content-Type": "text/yaml; charset=utf-8",
      "X-Content-Hash": data.contentHash,
      "Cache-Control": "no-store",
    },
  });
}
