import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { testDb } from "./setup";
import { createTestOrg } from "./helpers";

// Mock db to use test database
vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});

// Clerk's auth() is swapped per-test: each case sets the machine auth object
// the mocked SDK returns for `auth({ acceptsToken: "oauth_token" })`.
const authMock = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({ auth: (...args: unknown[]) => authMock(...args) }));

import { decodeOrgIdClaim, resolveOrgFromClerkOAuth } from "@/lib/auth";

function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "RS256", typ: "JWT" })}.${b64(payload)}.signature`;
}

function authenticatedMachine(userId: string) {
  return {
    isAuthenticated: true,
    tokenType: "oauth_token",
    userId,
    clientId: "client_abc123def456",
    scopes: ["email", "profile", "user:org:read"],
  };
}

describe("decodeOrgIdClaim", () => {
  it("extracts org_id from a JWT payload", () => {
    expect(decodeOrgIdClaim(fakeJwt({ sub: "user_1", org_id: "org_clerk_9" }))).toBe("org_clerk_9");
  });

  it("returns null when the claim is absent", () => {
    expect(decodeOrgIdClaim(fakeJwt({ sub: "user_1" }))).toBeNull();
  });

  it("returns null for empty-string and non-string org_id", () => {
    expect(decodeOrgIdClaim(fakeJwt({ org_id: "" }))).toBeNull();
    expect(decodeOrgIdClaim(fakeJwt({ org_id: 42 }))).toBeNull();
  });

  it("returns null for opaque (non-JWT) tokens and garbage", () => {
    expect(decodeOrgIdClaim("oat_opaquetoken")).toBeNull();
    expect(decodeOrgIdClaim("")).toBeNull();
    expect(decodeOrgIdClaim("a.!!!notbase64!!!.c")).toBeNull();
  });
});

// resolveOrgFromClerkOAuth reads AUTH_MODE at module load, so the clerk-mode
// tests stub the env and re-import a fresh module instance.
describe("resolveOrgFromClerkOAuth — clerk mode", () => {
  let resolveClerkOAuth: typeof resolveOrgFromClerkOAuth;

  beforeEach(async () => {
    vi.stubEnv("AUTH_MODE", "clerk");
    vi.resetModules();
    ({ resolveOrgFromClerkOAuth: resolveClerkOAuth } = await import("@/lib/auth"));
    authMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resolves the org from the token's org_id claim and upserts membership", async () => {
    const org = await createTestOrg({
      name: "OAuth Org",
      slug: "oauth-org",
      clerkOrgId: "org_clerk_claim",
    });
    authMock.mockResolvedValue(authenticatedMachine("user_oauth_1"));

    const ctx = await resolveClerkOAuth(fakeJwt({ sub: "user_oauth_1", org_id: "org_clerk_claim" }));

    expect(ctx).not.toBeNull();
    expect(ctx!.orgId).toBe(org.id);
    expect(ctx!.orgSlug).toBe("oauth-org");
    expect(ctx!.userId).toBe("user_oauth_1");
    expect(ctx!.scopes).toEqual(["read", "write"]);
    expect(ctx!.keyPrefix).toBe("oauth:client_abc12");

    const member = await testDb.orgMember.findUnique({
      where: { orgId_userId: { orgId: org.id, userId: "user_oauth_1" } },
    });
    expect(member).not.toBeNull();
    expect(member!.role).toBe("member");
  });

  it("preserves an existing member's role instead of resetting it", async () => {
    const org = await createTestOrg({
      name: "OAuth Role Org",
      slug: "oauth-role-org",
      clerkOrgId: "org_clerk_role",
    });
    await testDb.orgMember.create({
      data: { orgId: org.id, userId: "user_owner", role: "owner" },
    });
    authMock.mockResolvedValue(authenticatedMachine("user_owner"));

    const ctx = await resolveClerkOAuth(fakeJwt({ org_id: "org_clerk_role" }));
    expect(ctx!.role).toBe("owner");
  });

  it("limits viewers to read scope", async () => {
    const org = await createTestOrg({
      name: "OAuth Viewer Org",
      slug: "oauth-viewer-org",
      clerkOrgId: "org_clerk_viewer",
    });
    await testDb.orgMember.create({
      data: { orgId: org.id, userId: "user_viewer", role: "viewer" },
    });
    authMock.mockResolvedValue(authenticatedMachine("user_viewer"));

    const ctx = await resolveClerkOAuth(fakeJwt({ org_id: "org_clerk_viewer" }));
    expect(ctx!.scopes).toEqual(["read"]);
  });

  it("falls back to the user's sole membership when the token has no org claim", async () => {
    const org = await createTestOrg({ name: "Solo Org", slug: "solo-org" });
    await testDb.orgMember.create({
      data: { orgId: org.id, userId: "user_solo", role: "member" },
    });
    authMock.mockResolvedValue(authenticatedMachine("user_solo"));

    const ctx = await resolveClerkOAuth(fakeJwt({ sub: "user_solo" }));
    expect(ctx).not.toBeNull();
    expect(ctx!.orgId).toBe(org.id);
  });

  it("fails closed when the user belongs to multiple orgs and no org claim is present", async () => {
    const orgA = await createTestOrg({ name: "Multi A", slug: "multi-a" });
    const orgB = await createTestOrg({ name: "Multi B", slug: "multi-b" });
    await testDb.orgMember.create({ data: { orgId: orgA.id, userId: "user_multi", role: "member" } });
    await testDb.orgMember.create({ data: { orgId: orgB.id, userId: "user_multi", role: "member" } });
    authMock.mockResolvedValue(authenticatedMachine("user_multi"));

    const ctx = await resolveClerkOAuth(fakeJwt({ sub: "user_multi" }));
    expect(ctx).toBeNull();
  });

  it("returns null when the org_id claim matches no organization", async () => {
    authMock.mockResolvedValue(authenticatedMachine("user_ghost"));
    const ctx = await resolveClerkOAuth(fakeJwt({ org_id: "org_clerk_nonexistent" }));
    expect(ctx).toBeNull();
  });

  it("returns null for an unauthenticated token", async () => {
    authMock.mockResolvedValue({ isAuthenticated: false, tokenType: "oauth_token", userId: null });
    const ctx = await resolveClerkOAuth(fakeJwt({ org_id: "org_clerk_claim" }));
    expect(ctx).toBeNull();
  });

  it("returns null when Clerk verification throws", async () => {
    authMock.mockRejectedValue(new Error("clerk unreachable"));
    const ctx = await resolveClerkOAuth(fakeJwt({ org_id: "org_clerk_claim" }));
    expect(ctx).toBeNull();
  });
});

describe("resolveOrgFromClerkOAuth — non-clerk modes", () => {
  it("returns null without calling Clerk when AUTH_MODE is not clerk", async () => {
    authMock.mockReset();
    // Static import was loaded with the default AUTH_MODE ("none").
    const ctx = await resolveOrgFromClerkOAuth(fakeJwt({ org_id: "org_clerk_claim" }));
    expect(ctx).toBeNull();
    expect(authMock).not.toHaveBeenCalled();
  });
});
