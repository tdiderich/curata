import { headers } from "next/headers";
import { db } from "./db";
import { hashApiKey } from "./api-key";
import { isPersonalEmailDomain } from "./personal-domains";
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

async function findOrCreateMember(orgId: string, userId: string, defaultRole: Role) {
  return db.orgMember.upsert({
    where: { orgId_userId: { orgId, userId } },
    update: {},
    create: { orgId, userId, role: defaultRole },
  });
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

  const member = await findOrCreateMember(org.id, email, "member");
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
  if (AUTH_MODE === "clerk") return resolveOrgClerk();
  if (AUTH_MODE === "oauth") return resolveOrgOAuth();
  if (AUTH_MODE === "tailscale") return resolveOrgTailscale();
  return resolveOrgNone();
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

  return {
    orgId: apiKey.orgId,
    orgSlug: apiKey.org.slug,
    scopes: apiKey.scopes,
    keyPrefix: apiKey.prefix,
  };
}
