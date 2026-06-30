import { db } from "./db";
import { AUTH_MODE } from "./auth";
import type { OrgContext } from "./auth";

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

  if (AUTH_MODE === "none") {
    return {
      ...page,
      access: { allowed: true, pageId: page.id, role: "owner", via: "creator" },
    };
  }

  const access = await resolvePageAccess(page, userId, orgMemberRole, shareToken);
  if (!access) {
    throw new PageAccessError(404, "not found");
  }

  return { ...page, access };
}

export function listPagesWhere(
  orgId: string,
  userId: string | null
): Record<string, unknown> {
  if (AUTH_MODE === "none" || !userId) {
    return { orgId, status: { not: "archived" } };
  }

  return {
    orgId,
    status: { not: "archived" },
    OR: [
      { createdBy: userId },
      { shares: { some: { userId } } },
      { visibility: { in: ["org", "public", "shared"] } },
    ],
  };
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

export function isShareFeatureEnabled(): boolean {
  return AUTH_MODE !== "none" && AUTH_MODE !== "tailscale";
}
