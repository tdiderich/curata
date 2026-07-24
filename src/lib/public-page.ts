import { db } from "@/lib/db";

// Shared gate for the anonymous, non-HTML representations of a page (/raw,
// /md). It exists so those routes cannot drift apart from each other or from
// the HTML view: a page is reachable here only if it is visibility=public, or a
// valid share token resolves via resolvePageAccess.
//
// SECURITY: every failure path returns null and callers must answer with an
// identical 404, so the endpoints leak nothing about which private pages exist.

export interface PublicPageRef {
  orgId: string;
  orgName: string;
  pageId: string;
  slug: string;
  visibility: string;
}

export async function resolvePublicPage(
  orgSlug: string,
  pageSlug: string,
  shareToken?: string,
): Promise<PublicPageRef | null> {
  const org = await db.organization.findUnique({
    where: { slug: orgSlug },
    select: { id: true, name: true },
  });
  if (!org) return null;

  const page = await db.page.findUnique({
    where: { orgId_slug: { orgId: org.id, slug: pageSlug } },
    select: { id: true, orgId: true, slug: true, visibility: true, createdBy: true },
  });
  if (!page) return null;

  if (page.visibility !== "public") {
    if (!shareToken) return null;
    const { resolvePageAccess } = await import("@/lib/access");
    // No user, no org role: an anonymous caller only passes via public
    // visibility (handled above) or a valid share token.
    const access = await resolvePageAccess(page, null, null, shareToken);
    if (!access) return null;
  }

  return {
    orgId: org.id,
    orgName: org.name,
    pageId: page.id,
    slug: page.slug,
    visibility: page.visibility,
  };
}
