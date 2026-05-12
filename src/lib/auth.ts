import { db } from "./db";
import { hashApiKey } from "./api-key";
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

const AUTH_MODE = process.env.AUTH_MODE ?? "none";

// Static default user for no-auth mode
const DEFAULT_USER: CurrentUser = {
  id: "default",
  email: "admin@localhost",
  name: "Admin",
};

async function resolveOrgNone(): Promise<OrgContext | null> {
  // In no-auth mode, find the single implicit org
  try {
    const org = await db.organization.findFirst({
      orderBy: { createdAt: "asc" },
    });
    if (!org) return null;

    // Ensure a default member record exists
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
  const { auth: getSession } = await import("@/lib/next-auth");
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

export async function resolveOrg(): Promise<OrgContext | null> {
  if (AUTH_MODE === "oauth") {
    return resolveOrgOAuth();
  }
  // Default: no-auth mode
  return resolveOrgNone();
}

export async function resolveCurrentUser(): Promise<CurrentUser | null> {
  if (AUTH_MODE === "oauth") {
    const { auth: getSession } = await import("@/lib/next-auth");
    const session = await getSession();
    if (!session?.user) return null;
    return {
      id: session.user.id ?? session.user.email ?? "unknown",
      email: session.user.email ?? "",
      name: session.user.name ?? session.user.email ?? "Unknown",
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
