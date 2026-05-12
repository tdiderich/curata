import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { testDb } from "./setup";
import { createTestOrg, createTestApiKey } from "./helpers";

// Mock db to use test database
vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});

import { resolveOrgFromApiKey, resolveOrg, resolveCurrentUser } from "@/lib/auth";

describe("auth", () => {
  let orgId: string;

  beforeEach(async () => {
    const org = await createTestOrg({ name: "Auth Test Org", slug: "auth-test-org" });
    orgId = org.id;
  });

  describe("resolveOrgFromApiKey", () => {
    it("returns org context for a valid API key", async () => {
      const { key } = await createTestApiKey(orgId);
      const ctx = await resolveOrgFromApiKey(key);

      expect(ctx).not.toBeNull();
      expect(ctx!.orgId).toBe(orgId);
      expect(ctx!.orgSlug).toBe("auth-test-org");
      expect(ctx!.scopes).toContain("read");
    });

    it("returns null for an unknown key", async () => {
      const ctx = await resolveOrgFromApiKey("ck_totally_unknown_key_abc123");
      expect(ctx).toBeNull();
    });

    it("returns null for a revoked key", async () => {
      const { key, record } = await createTestApiKey(orgId);
      await testDb.apiKey.update({
        where: { id: record.id },
        data: { revokedAt: new Date() },
      });

      const ctx = await resolveOrgFromApiKey(key);
      expect(ctx).toBeNull();
    });
  });
});

// ── no-auth mode tests ────────────────────────────────────────────────────────
// AUTH_MODE defaults to "none" when the env var is not set, so these tests
// exercise resolveOrg() / resolveCurrentUser() without any extra setup.

describe("resolveOrg — no-auth mode", () => {
  it("returns OrgContext with static default user when org exists", async () => {
    const org = await createTestOrg({ name: "No-Auth Org", slug: "no-auth-org" });
    const ctx = await resolveOrg();

    expect(ctx).not.toBeNull();
    expect(ctx!.orgId).toBe(org.id);
    expect(ctx!.orgSlug).toBe("no-auth-org");
    expect(ctx!.userId).toBe("default");
    expect(ctx!.role).toBe("owner");
  });

  it("returns null when no org exists (before seed)", async () => {
    // setup.ts truncates all tables in beforeEach; no org has been created in
    // this test, so the DB is empty and resolveOrg() should return null.
    const ctx = await resolveOrg();
    expect(ctx).toBeNull();
  });
});

describe("resolveCurrentUser — no-auth mode", () => {
  it("returns static default user", async () => {
    const user = await resolveCurrentUser();
    expect(user).not.toBeNull();
    expect(user!.id).toBe("default");
    expect(user!.email).toBe("admin@localhost");
    expect(user!.name).toBe("Admin");
  });
});

// ── oauth mode tests ──────────────────────────────────────────────────────────
// AUTH_MODE is read once at module load time. To test the oauth branch we:
//   1. stub AUTH_MODE=oauth in the environment
//   2. reset the module registry so @/lib/auth re-evaluates AUTH_MODE
//   3. mock @/lib/next-auth to return a null session
//   4. dynamically import the fresh copy of @/lib/auth

describe("resolveOrg — oauth mode", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.doUnmock("@/lib/next-auth");
  });

  it("returns null when no session exists", async () => {
    vi.stubEnv("AUTH_MODE", "oauth");
    vi.doMock("@/lib/next-auth", () => ({
      auth: vi.fn().mockResolvedValue(null),
    }));
    vi.resetModules();

    const { resolveOrg: resolveOrgFresh } = await import("@/lib/auth");
    const ctx = await resolveOrgFresh();
    expect(ctx).toBeNull();
  });
});

describe("resolveCurrentUser — oauth mode", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.doUnmock("@/lib/next-auth");
  });

  it("returns null when no session exists", async () => {
    vi.stubEnv("AUTH_MODE", "oauth");
    vi.doMock("@/lib/next-auth", () => ({
      auth: vi.fn().mockResolvedValue(null),
    }));
    vi.resetModules();

    const { resolveCurrentUser: resolveCurrentUserFresh } = await import("@/lib/auth");
    const user = await resolveCurrentUserFresh();
    expect(user).toBeNull();
  });
});
