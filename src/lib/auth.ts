import { headers } from "next/headers";
import { db } from "./db";
import { hashApiKey } from "./api-key";
import { isPersonalEmailDomain } from "./personal-domains";
import { getEntitlements } from "./entitlements";
import type { Role } from "./permissions";

export interface OrgContext {
  orgId: string;
  orgSlug: string;
  userId: string;
  role: Role;
}

export interface ApiKeyContext {
  orgId: string;
  orgSlug: string;
  userId: string;
  role: Role;
  scopes: string[];
  keyPrefix: string;
}

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
}

export const AUTH_MODE = process.env.AUTH_MODE ?? "none";

const DEFAULT_USER: CurrentUser = {
  id: "default",
  email: "admin@localhost",
  name: "Admin",
};

const VALID_ROLES: readonly string[] = ["owner", "admin", "member", "viewer"];

function normalizeClerkRole(clerkRole: string): Role {
  if (clerkRole === "org:admin") return "owner";
  if (clerkRole === "org:member") return "member";
  if (VALID_ROLES.includes(clerkRole)) return clerkRole as Role;
  return "member";
}

/**
 * Thrown by findOrCreateMember when an org is at its plan's member cap and
 * a brand-new member would need to be created. Never thrown for a userId
 * that already has an OrgMember row — existing members always resolve.
 * resolveOrg() catches this and normalizes it back to `null` (same as any
 * other "no access" case) so the ~30 existing callers of resolveOrg() need
 * no changes; hosted-fork surfaces that want the specific reason (to link
 * to a billing page) can call findOrCreateMember's callers directly and
 * check `err instanceof MemberLimitError`.
 */
export class MemberLimitError extends Error {
  constructor(public readonly maxMembers: number) {
    super(`This workspace's plan supports ${maxMembers} member(s). Upgrade to add more.`);
    this.name = "MemberLimitError";
  }
}

/**
 * The member-add choke point: every auto-join-on-login path (Clerk org
 * membership sync, Clerk OAuth token sync, Tailscale auto-join) routes
 * through here rather than creating OrgMember rows directly. Existing
 * members are never re-checked against entitlements — only the create
 * branch is gated, and removal isn't handled by this function at all.
 */
async function findOrCreateMember(orgId: string, userId: string, defaultRole: Role) {
  const existing = await db.orgMember.findUnique({
    where: { orgId_userId: { orgId, userId } },
  });
  if (existing) return existing;

  const { maxMembers } = await getEntitlements(orgId);
  const memberCount = await db.orgMember.count({ where: { orgId } });
  if (memberCount >= maxMembers) {
    throw new MemberLimitError(maxMembers);
  }

  return db.orgMember.create({ data: { orgId, userId, role: defaultRole } });
}

async function resolveOrgNone(): Promise<OrgContext | null> {
  try {
    const org = await db.organization.findFirst({
      orderBy: { createdAt: "asc" },
    });
    if (!org) return null;

    const member = await db.orgMember.upsert({
      where: { orgId_userId: { orgId: org.id, userId: DEFAULT_USER.id } },
      update: {},
      create: { orgId: org.id, userId: DEFAULT_USER.id, role: "owner" },
    });

    return {
      orgId: org.id,
      orgSlug: org.slug,
      userId: DEFAULT_USER.id,
      role: member.role as Role,
    };
  } catch {
    return null;
  }
}

async function resolveOrgOAuth(): Promise<OrgContext | null> {
  const mod = await (import("@/lib/next-auth") as Promise<{ auth: () => Promise<{ user?: { id?: string; email?: string; name?: string } } | null> }>);
  const getSession = mod.auth;
  const session = await getSession();
  if (!session?.user?.email) return null;

  const userId = session.user.id ?? session.user.email;

  const member = await db.orgMember.findFirst({
    where: { userId },
    include: { org: true },
  });
  if (!member) return null;

  return {
    orgId: member.orgId,
    orgSlug: member.org.slug,
    userId,
    role: member.role as Role,
  };
}

export async function getTailscaleIdentity(): Promise<{ login: string; name: string; profilePic: string } | null> {
  const h = await headers();
  const login = h.get("tailscale-user-login");
  if (login) {
    return {
      login,
      name: h.get("tailscale-user-name") ?? login,
      profilePic: h.get("tailscale-user-profile-pic") ?? "",
    };
  }
  if (process.env.NODE_ENV === "development" && process.env.TAILSCALE_DEV_USER) {
    const devUser = process.env.TAILSCALE_DEV_USER;
    return {
      login: devUser,
      name: process.env.TAILSCALE_DEV_NAME ?? devUser.split("@")[0] ?? devUser,
      profilePic: "",
    };
  }
  return null;
}

async function resolveOrgTailscale(): Promise<OrgContext | null> {
  const identity = await getTailscaleIdentity();
  if (!identity) return null;

  const email = identity.login;

  const org = await db.organization.findFirst({ orderBy: { createdAt: "asc" } });
  if (!org) return null;

  const hasRealOwner = await db.orgMember.findFirst({
    where: { orgId: org.id, role: { in: ["owner", "admin"] }, userId: { not: "default" } },
  });

  let member;
  if (!hasRealOwner) {
    member = await db.orgMember.upsert({
      where: { orgId_userId: { orgId: org.id, userId: email } },
      update: { role: "owner" },
      create: { orgId: org.id, userId: email, role: "owner" },
    });
  } else {
    member = await findOrCreateMember(org.id, email, "member");
  }
  return {
    orgId: org.id,
    orgSlug: org.slug,
    userId: email,
    role: member.role as Role,
  };
}

async function resolveOrgClerk(): Promise<OrgContext | null> {
  const { auth, currentUser } = await import("@clerk/nextjs/server");
  const { userId, orgId: clerkOrgId, orgRole } = await auth();
  if (!userId) return null;

  if (clerkOrgId) {
    const org = await db.organization.findUnique({ where: { clerkOrgId } });
    if (!org) return null;

    if (!org.domain) {
      try {
        const user = await currentUser();
        const email = user?.emailAddresses?.find(
          (e) => e.id === user.primaryEmailAddressId
        )?.emailAddress;
        if (email) {
          const emailDomain = email.split("@")[1]?.toLowerCase();
          if (emailDomain && !isPersonalEmailDomain(emailDomain)) {
            await db.organization.update({
              where: { id: org.id },
              data: { domain: emailDomain },
            });
          }
        }
      } catch {
        // best-effort
      }
    }

    const role = orgRole ? normalizeClerkRole(orgRole) : "member";
    const member = await findOrCreateMember(org.id, userId, role);
    return { orgId: org.id, orgSlug: org.slug, userId, role: normalizeClerkRole(member.role) };
  }

  const user = await currentUser();
  if (!user) return null;

  const email = user.emailAddresses?.find(
    (e) => e.id === user.primaryEmailAddressId
  )?.emailAddress;
  if (!email) return null;

  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return null;

  const org = await db.organization.findFirst({ where: { domain } });
  if (!org) return null;

  const member = await findOrCreateMember(org.id, userId, "member");
  return { orgId: org.id, orgSlug: org.slug, userId, role: normalizeClerkRole(member.role) };
}

export async function resolveOrg(): Promise<OrgContext | null> {
  try {
    if (AUTH_MODE === "clerk") return await resolveOrgClerk();
    if (AUTH_MODE === "oauth") return await resolveOrgOAuth();
    if (AUTH_MODE === "tailscale") return await resolveOrgTailscale();
    return await resolveOrgNone();
  } catch (err) {
    // A blocked new-member add reads the same as "no context" to every
    // existing caller (redirect to sign-in/onboarding, 401, etc). Hosted
    // forks that want to show an upgrade prompt instead should catch
    // MemberLimitError at their own entry point (e.g. the onboarding page).
    if (err instanceof MemberLimitError) return null;
    throw err;
  }
}

export async function resolveCurrentUser(): Promise<CurrentUser | null> {
  if (AUTH_MODE === "clerk") {
    const { currentUser } = await import("@clerk/nextjs/server");
    const user = await currentUser();
    if (!user) return null;
    const email = user.emailAddresses?.find(
      (e) => e.id === user.primaryEmailAddressId
    )?.emailAddress ?? "";
    return {
      id: user.id,
      email,
      name: user.firstName ? `${user.firstName} ${user.lastName ?? ""}`.trim() : email || "Unknown",
    };
  }
  if (AUTH_MODE === "oauth") {
    const mod = await (import("@/lib/next-auth") as Promise<{ auth: () => Promise<{ user?: { id?: string; email?: string; name?: string } } | null> }>);
  const getSession = mod.auth;
    const session = await getSession();
    if (!session?.user) return null;
    return {
      id: session.user.id ?? session.user.email ?? "unknown",
      email: session.user.email ?? "",
      name: session.user.name ?? session.user.email ?? "Unknown",
    };
  }
  if (AUTH_MODE === "tailscale") {
    const identity = await getTailscaleIdentity();
    if (!identity) return null;
    return {
      id: identity.login,
      email: identity.login,
      name: identity.name,
    };
  }
  return DEFAULT_USER;
}

/**
 * Extracts the `org_id` claim from a Clerk OAuth access token. Clerk's SDK
 * verifies the token's signature in `auth({ acceptsToken: "oauth_token" })`
 * but does not surface org claims on the machine auth object, so the claim is
 * read from the (already verified) payload here. Present only when the OAuth
 * app requests the `user:org:read` scope and the user selects an organization
 * on the consent screen.
 */
export function decodeOrgIdClaim(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof json !== "object" || json === null) return null;
    const orgId = (json as Record<string, unknown>).org_id;
    return typeof orgId === "string" && orgId ? orgId : null;
  } catch {
    return null;
  }
}

/**
 * Resolves org context from a Clerk OAuth access token (MCP clients arriving
 * through the OAuth 2.1 connector flow, as opposed to curata API keys).
 * Requires AUTH_MODE=clerk and a request that passed through clerkMiddleware.
 *
 * Org resolution order:
 * 1. `org_id` claim on the token (user picked an org at consent).
 * 2. The user's sole OrgMember row, when they belong to exactly one org.
 * Ambiguous membership without an org claim fails closed.
 */
export async function resolveOrgFromClerkOAuth(
  bearerToken: string
): Promise<ApiKeyContext | null> {
  if (AUTH_MODE !== "clerk") return null;

  const { auth } = await import("@clerk/nextjs/server");
  let machine;
  try {
    machine = await auth({ acceptsToken: "oauth_token" });
  } catch {
    return null;
  }
  if (!machine.isAuthenticated || machine.tokenType !== "oauth_token" || !machine.userId) {
    return null;
  }
  const userId = machine.userId;
  const clientId = machine.clientId ?? "unknown";

  const clerkOrgId = decodeOrgIdClaim(bearerToken);
  let org: { id: string; slug: string } | null = null;

  if (clerkOrgId) {
    org = await db.organization.findUnique({
      where: { clerkOrgId },
      select: { id: true, slug: true },
    });
  } else {
    const memberships = await db.orgMember.findMany({
      where: { userId },
      select: { orgId: true, org: { select: { slug: true } } },
      take: 2,
    });
    if (memberships.length === 1) {
      org = { id: memberships[0].orgId, slug: memberships[0].org.slug };
    }
  }
  if (!org) return null;

  let member;
  try {
    member = await findOrCreateMember(org.id, userId, "member");
  } catch (err) {
    if (err instanceof MemberLimitError) return null;
    throw err;
  }
  const role = normalizeClerkRole(member.role);

  return {
    orgId: org.id,
    orgSlug: org.slug,
    userId,
    role,
    scopes: role === "viewer" ? ["read"] : ["read", "write"],
    keyPrefix: `oauth:${clientId.slice(0, 12)}`,
  };
}

export async function resolveOrgFromApiKey(
  bearerToken: string
): Promise<ApiKeyContext | null> {
  const keyHash = hashApiKey(bearerToken);

  const apiKey = await db.apiKey.findUnique({
    where: { keyHash },
    include: { org: true },
  });

  if (!apiKey || apiKey.revokedAt) return null;
  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) return null;

  const userId = apiKey.createdBy;
  let role: Role = "member";

  if (userId && userId !== "system" && userId !== "web" && userId !== "migration") {
    const member = await db.orgMember.findUnique({
      where: { orgId_userId: { orgId: apiKey.orgId, userId } },
    });
    if (member) {
      role = member.role as Role;
    }
  } else {
    role = "owner";
  }

  return {
    orgId: apiKey.orgId,
    orgSlug: apiKey.org.slug,
    userId,
    role,
    scopes: apiKey.scopes,
    keyPrefix: apiKey.prefix,
  };
}
