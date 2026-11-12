import { db } from "./db";
import { AUTH_MODE } from "./auth";

export type PageRole = "owner" | "editor" | "viewer";

export interface PageAccess {
  allowed: true;
  pageId: string;
  role: PageRole;
  via: "creator" | "share" | "org" | "public" | "share-link";
}

interface PageRow {
  id: string;
  orgId: string;
  slug: string;
  visibility: string;
  createdBy: string;
}

export async function resolvePageAccess(
  page: PageRow,
  userId: string | null,
  orgMemberRole: string | null,
  shareToken?: string
): Promise<PageAccess | null> {
  if (userId && page.createdBy === userId) {
    return { allowed: true, pageId: page.id, role: "owner", via: "creator" };
  }

  if (userId && isShareFeatureEnabled()) {
    const share = await db.pageShare.findUnique({
      where: { pageId_userId: { pageId: page.id, userId } },
    });
    if (share) {
      return {
        allowed: true,
        pageId: page.id,
        role: share.role === "editor" ? "editor" : "viewer",
        via: "share",
      };
    }
  }

  const vis = page.visibility ?? "org";

  if ((vis === "org" || vis === "shared") && orgMemberRole) {
    return { allowed: true, pageId: page.id, role: "viewer", via: "org" };
  }

  if (vis === "public") {
    return { allowed: true, pageId: page.id, role: "viewer", via: "public" };
  }

  if (shareToken) {
    const link = await db.shareLink.findUnique({ where: { token: shareToken } });
    if (
      link &&
      link.pageId === page.id &&
      !link.revokedAt &&
      (!link.expiresAt || link.expiresAt > new Date())
    ) {
      return {
        allowed: true,
        pageId: page.id,
        role: link.role === "editor" ? "editor" : "viewer",
        via: "share-link",
      };
    }
  }

  return null;
}

export async function getPageOrThrow(
  orgId: string,
  slug: string,
  userId: string | null,
  orgMemberRole: string | null,
  shareToken?: string
): Promise<PageRow & { access: PageAccess }> {
  const page = await db.page.findUnique({
    where: { orgId_slug: { orgId, slug } },
    select: {
      id: true,
      orgId: true,
      slug: true,
      visibility: true,
      createdBy: true,
    },
  });

  if (!page) {
    throw new PageAccessError(404, "not found");
  }

  const access = await pageAccessFor(page, userId, orgMemberRole, shareToken);
  if (!access) {
    throw new PageAccessError(404, "not found");
  }

  return { ...page, access };
}

/// resolvePageAccess plus the AUTH_MODE=none shortcut (every caller is the
/// single default owner). Use this when you already hold the page row, e.g.
/// filtering a batch of pages; getPageOrThrow wraps it for a single slug.
export async function pageAccessFor(
  page: PageRow,
  userId: string | null,
  orgMemberRole: string | null,
  shareToken?: string
): Promise<PageAccess | null> {
  if (AUTH_MODE === "none") {
    return { allowed: true, pageId: page.id, role: "owner", via: "creator" };
  }
  return resolvePageAccess(page, userId, orgMemberRole, shareToken);
}

/// Page-level half of an edit check; the org-role half stays with
/// can(role, "page:edit"). A private page is only reachable through its
/// creator or a share, so the share role decides: a viewer share can read it
/// but not change it. Org, shared and public pages are reachable by org
/// membership, where the org role already decides.
export function pageEditable(page: { visibility: string | null }, access: PageAccess): boolean {
  return canEditPage(access) || (page.visibility ?? "org") !== "private";
}

export function assertPageEditable(page: { visibility: string | null; access: PageAccess }): void {
  if (!pageEditable(page, page.access)) {
    throw new PageAccessError(403, "forbidden: you have view-only access to this page");
  }
}

/// Owner-only actions on a private page: changing its visibility, deleting
/// it. An editor share lets someone change a private page's content, not
/// widen who can see it or remove it. Org, shared and public pages keep the
/// org-role rule.
export function ownerActionAllowed(page: { visibility: string | null }, access: PageAccess): boolean {
  return (page.visibility ?? "org") !== "private" || access.role === "owner";
}

export function assertOwnerAction(page: { visibility: string | null; access: PageAccess }): void {
  if (!ownerActionAllowed(page, page.access)) {
    throw new PageAccessError(403, "forbidden: only the page owner can change visibility of or delete a private page");
  }
}

/// Page lookup for lib code that knows the caller only by user id (chart,
/// scope, dependency tools). Returns null when the page is missing or the
/// caller can't see it, so the caller's existing "page not found" path
/// handles both alike. mode "edit" throws a 403 when the caller holds only a
/// viewer share on a private page. No userId means an internal caller:
/// unfiltered, as in listPagesWhere.
export async function findPageFor(
  orgId: string,
  slug: string,
  userId: string | null | undefined,
  mode: "view" | "edit" = "view"
): Promise<(PageRow & { title: string; folderId: string | null }) | null> {
  const page = await db.page.findUnique({
    where: { orgId_slug: { orgId, slug } },
    select: { id: true, orgId: true, slug: true, title: true, folderId: true, visibility: true, createdBy: true },
  });
  if (!page || !userId) return page;
  const access = await pageAccessFor(page, userId, "member");
  if (!access) return null;
  if (mode === "edit" && !pageEditable(page, access)) {
    throw new PageAccessError(403, `forbidden: you have view-only access to page ${slug}`);
  }
  return page;
}

/// The visibility half of listPagesWhere, without the archived filter: for
/// queues that also list archived pages (flags) or that join pages by slug.
export function pageVisibilityWhere(userId: string | null): Record<string, unknown> {
  if (AUTH_MODE === "none" || !userId) return {};
  return {
    OR: [
      { createdBy: userId },
      { shares: { some: { userId } } },
      { visibility: { in: ["org", "public", "shared"] } },
    ],
  };
}

export function listPagesWhere(
  orgId: string,
  userId: string | null
): Record<string, unknown> {
  return { orgId, status: { not: "archived" }, ...pageVisibilityWhere(userId) };
}

export function canEditPage(access: PageAccess): boolean {
  return access.role === "owner" || access.role === "editor";
}

export class PageAccessError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "PageAccessError";
  }
}

export function defaultPageVisibility(): "private" | "org" {
  return AUTH_MODE === "clerk" || AUTH_MODE === "oauth" ? "private" : "org";
}

export function mcpDefaultVisibility(): "private" | "org" {
  return AUTH_MODE === "none" ? "org" : "private";
}

const VIS_RANK: Record<string, number> = { private: 0, org: 1, shared: 1, public: 2 };

export function checkFolderBoundary(pageVis: string, folderVis: string | null | undefined): void {
  if (!folderVis) return;
  const pageRank = VIS_RANK[pageVis] ?? 0;
  const folderRank = VIS_RANK[folderVis] ?? 0;
  if (pageRank < folderRank) {
    throw new Error(
      `visibility "${pageVis}" is below folder minimum "${folderVis}" — pages in this folder must be "${folderVis}" or higher`
    );
  }
}

export function isShareFeatureEnabled(): boolean {
  return AUTH_MODE !== "none" && AUTH_MODE !== "tailscale";
}
