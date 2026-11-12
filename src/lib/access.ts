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

/// Denial messages, shared by every route and MCP tool so the wording
/// doesn't drift.
export const VIEW_ONLY_MESSAGE = "forbidden: you have view-only access to this page";
export const OWNER_ONLY_MESSAGE = "forbidden: only the page owner can change visibility of or delete a private page";

export function assertPageEditable(page: { visibility: string | null; access: PageAccess }): void {
  if (!pageEditable(page, page.access)) {
    throw new PageAccessError(403, VIEW_ONLY_MESSAGE);
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
    throw new PageAccessError(403, OWNER_ONLY_MESSAGE);
  }
}

/// Page lookup for lib code that knows the caller by user id (chart, scope,
/// dependency tools). Returns null when the page is missing or hidden from
/// the caller, so the caller's existing "page not found" path handles both
/// alike; mode "view" never throws. mode "edit" throws a 403 when the caller
/// holds only a viewer share on a private page. The org-role half of an edit
/// check (can(role, "page:edit")) stays with the route. userId null means an
/// internal caller: unfiltered, as in listPagesWhere.
export async function findPageFor(
  orgId: string,
  slug: string,
  userId: string | null,
  mode: "view" | "edit" = "view",
  orgRole = "member"
): Promise<(PageRow & { title: string; folderId: string | null; status: string }) | null> {
  const page = await db.page.findUnique({
    where: { orgId_slug: { orgId, slug } },
    select: { id: true, orgId: true, slug: true, title: true, folderId: true, status: true, visibility: true, createdBy: true },
  });
  if (!page || !userId) return page;
  const access = await pageAccessFor(page, userId, orgRole);
  if (!access) return null;
  if (mode === "edit" && !pageEditable(page, access)) {
    throw new PageAccessError(403, VIEW_ONLY_MESSAGE);
  }
  return page;
}

/// Why a folder can't take a visibility: pages inside below the new minimum.
/// Names only the pages the caller can see; someone else's private page is
/// mentioned without slug or count, so the message doesn't reveal it. Null
/// when nothing blocks the change.
export async function folderVisibilityBlocker(
  folderId: string,
  target: string,
  userId: string | null,
  orgRole = "member"
): Promise<string | null> {
  const pages = await db.page.findMany({
    where: { folderId },
    select: { id: true, orgId: true, slug: true, visibility: true, createdBy: true },
  });
  const below = pages.filter((p) => {
    try { checkFolderBoundary(p.visibility ?? "org", target); return false; } catch { return true; }
  });
  if (below.length === 0) return null;
  const named: string[] = [];
  let hidden = false;
  for (const p of below) {
    if (!userId || (await pageAccessFor(p, userId, orgRole))) named.push(p.slug);
    else hidden = true;
  }
  const parts = [
    named.length > 0 ? `${named.length} page(s) have lower visibility: ${named.join(", ")}` : null,
    hidden ? "it holds private pages owned by someone else" : null,
  ].filter(Boolean);
  return `cannot set folder to "${target}" — ${parts.join("; ")}`;
}

/// For server components: true when the caller may open the page. A hidden
/// page renders as not found, like the API.
export async function canOpenPage(ctx: { orgId: string; userId: string; role: string }, slug: string): Promise<boolean> {
  try {
    await getPageOrThrow(ctx.orgId, slug, ctx.userId, ctx.role);
    return true;
  } catch (e) {
    if (e instanceof PageAccessError) return false;
    throw e;
  }
}

/// The visibility half of listPagesWhere, without the archived filter: for
/// queues that also list archived pages (flags) or that join pages by slug.
export function pageVisibilityWhere(userId: string | null): Record<string, unknown> {
  if (AUTH_MODE === "none" || !userId) return {};
  return {
    OR: [
      { createdBy: userId },
      // Same gate as resolvePageAccess: share rows count only where shares exist.
      ...(isShareFeatureEnabled() ? [{ shares: { some: { userId } } }] : []),
      { visibility: { in: ["org", "public", "shared"] } },
    ],
  };
}

/// Pages the caller may change, as a where clause: everything visible minus
/// private pages held through a viewer share (pageEditable as a query).
export function editablePagesWhere(orgId: string, userId: string | null): Record<string, unknown> {
  if (AUTH_MODE === "none" || !userId) return { orgId };
  return {
    orgId,
    OR: [
      { createdBy: userId },
      ...(isShareFeatureEnabled() ? [{ shares: { some: { userId, role: "editor" } } }] : []),
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
