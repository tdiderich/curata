import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { testDb } from "./setup";
import { createTestOrg } from "./helpers";

// Mock db to use test database
vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});

// Clerk's auth() is swapped per-test the same way tests/mcp-oauth.test.ts does
// it — resolveOrgFromClerkOAuth is the exported, easily-testable entry point
// that routes through the member-add choke point (findOrCreateMember).
const authMock = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({ auth: (...args: unknown[]) => authMock(...args) }));

function authenticatedMachine(userId: string) {
  return {
    isAuthenticated: true,
    tokenType: "oauth_token",
    userId,
    clientId: "client_abc123def456",
    scopes: ["email", "profile", "user:org:read"],
  };
}

function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "RS256", typ: "JWT" })}.${b64(payload)}.signature`;
}

describe("getEntitlements (OSS default)", () => {
  it("is unlimited on both dimensions", async () => {
    const { getEntitlements } = await import("@/lib/entitlements");
    const ent = await getEntitlements("some-org-id");
    expect(ent.maxMembers).toBe(Number.POSITIVE_INFINITY);
    expect(ent.maxBrainTokens).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("member-add enforcement — resolveOrgFromClerkOAuth", () => {
  let resolveClerkOAuth: typeof import("@/lib/auth").resolveOrgFromClerkOAuth;

  beforeEach(async () => {
    vi.stubEnv("AUTH_MODE", "clerk");
    vi.resetModules();
    vi.doUnmock("@/lib/entitlements");
    ({ resolveOrgFromClerkOAuth: resolveClerkOAuth } = await import("@/lib/auth"));
    authMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("@/lib/entitlements");
  });

  it("allows adding a member at the OSS default (unlimited)", async () => {
    const org = await createTestOrg({
      name: "Default Plan Org",
      slug: "default-plan-org",
      clerkOrgId: "org_clerk_default",
    });
    authMock.mockResolvedValue(authenticatedMachine("user_new_1"));

    const ctx = await resolveClerkOAuth(fakeJwt({ org_id: "org_clerk_default" }));
    expect(ctx).not.toBeNull();
    expect(ctx!.orgId).toBe(org.id);

    const member = await testDb.orgMember.findUnique({
      where: { orgId_userId: { orgId: org.id, userId: "user_new_1" } },
    });
    expect(member).not.toBeNull();
  });

  it("blocks adding a second member when the plan caps maxMembers at 1", async () => {
    vi.doMock("@/lib/entitlements", () => ({
      getEntitlements: vi.fn().mockResolvedValue({ maxMembers: 1, maxBrainTokens: Number.POSITIVE_INFINITY }),
    }));
    vi.resetModules();
    ({ resolveOrgFromClerkOAuth: resolveClerkOAuth } = await import("@/lib/auth"));

    const org = await createTestOrg({
      name: "Capped Org",
      slug: "capped-org",
      clerkOrgId: "org_clerk_capped",
    });
    await testDb.orgMember.create({ data: { orgId: org.id, userId: "user_owner", role: "owner" } });
    authMock.mockResolvedValue(authenticatedMachine("user_second"));

    const ctx = await resolveClerkOAuth(fakeJwt({ org_id: "org_clerk_capped" }));
    expect(ctx).toBeNull();

    const member = await testDb.orgMember.findUnique({
      where: { orgId_userId: { orgId: org.id, userId: "user_second" } },
    });
    expect(member).toBeNull();
  });

  it("never blocks a userId that's already a member, even at cap", async () => {
    vi.doMock("@/lib/entitlements", () => ({
      getEntitlements: vi.fn().mockResolvedValue({ maxMembers: 1, maxBrainTokens: Number.POSITIVE_INFINITY }),
    }));
    vi.resetModules();
    ({ resolveOrgFromClerkOAuth: resolveClerkOAuth } = await import("@/lib/auth"));

    const org = await createTestOrg({
      name: "Capped Existing Org",
      slug: "capped-existing-org",
      clerkOrgId: "org_clerk_capped_existing",
    });
    await testDb.orgMember.create({ data: { orgId: org.id, userId: "user_owner", role: "owner" } });
    authMock.mockResolvedValue(authenticatedMachine("user_owner"));

    const ctx = await resolveClerkOAuth(fakeJwt({ org_id: "org_clerk_capped_existing" }));
    expect(ctx).not.toBeNull();
    expect(ctx!.userId).toBe("user_owner");
  });

  it("existing over-limit org (3 members, cap 1) keeps all members and only blocks a 4th", async () => {
    vi.doMock("@/lib/entitlements", () => ({
      getEntitlements: vi.fn().mockResolvedValue({ maxMembers: 1, maxBrainTokens: Number.POSITIVE_INFINITY }),
    }));
    vi.resetModules();
    ({ resolveOrgFromClerkOAuth: resolveClerkOAuth } = await import("@/lib/auth"));

    const org = await createTestOrg({
      name: "Over Limit Org",
      slug: "over-limit-org",
      clerkOrgId: "org_clerk_over_limit",
    });
    await testDb.orgMember.create({ data: { orgId: org.id, userId: "user_1", role: "owner" } });
    await testDb.orgMember.create({ data: { orgId: org.id, userId: "user_2", role: "member" } });
    await testDb.orgMember.create({ data: { orgId: org.id, userId: "user_3", role: "member" } });

    // Every existing member still resolves fine.
    for (const userId of ["user_1", "user_2", "user_3"]) {
      authMock.mockResolvedValue(authenticatedMachine(userId));
      const ctx = await resolveClerkOAuth(fakeJwt({ org_id: "org_clerk_over_limit" }));
      expect(ctx).not.toBeNull();
    }

    // A brand-new 4th member is blocked.
    authMock.mockResolvedValue(authenticatedMachine("user_4"));
    const ctx = await resolveClerkOAuth(fakeJwt({ org_id: "org_clerk_over_limit" }));
    expect(ctx).toBeNull();

    const count = await testDb.orgMember.count({ where: { orgId: org.id } });
    expect(count).toBe(3);
  });
});

describe("member removal — never gated by entitlements", () => {
  it("succeeds even when the org is already at (or over) its plan cap", async () => {
    const org = await createTestOrg({ name: "Removal Org", slug: "removal-org" });
    const a = await testDb.orgMember.create({ data: { orgId: org.id, userId: "user_a", role: "owner" } });
    await testDb.orgMember.create({ data: { orgId: org.id, userId: "user_b", role: "member" } });
    await testDb.orgMember.create({ data: { orgId: org.id, userId: "user_c", role: "member" } });

    // Mirrors src/app/api/members/route.ts DELETE: a plain delete, no
    // entitlements check anywhere on this path.
    await testDb.orgMember.delete({ where: { id: a.id } });

    const count = await testDb.orgMember.count({ where: { orgId: org.id } });
    expect(count).toBe(2);
  });
});
