import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { testDb } from "./setup";
import { createTestOrg } from "./helpers";

// Mock db to use test database
vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});

// No filesystem/background-build side effects from the write path.
vi.mock("@/lib/kazam", async () => {
  const os = await import("os");
  const path = await import("path");
  const tmpDir = path.join(os.tmpdir(), `curata-test-restore-cap-${process.pid}`);
  return {
    sitePath: () => tmpDir,
    buildSite: vi.fn().mockResolvedValue(""),
    validateContent: vi.fn().mockResolvedValue([]),
    checkUnsupportedComponents: vi.fn().mockReturnValue([]),
  };
});
vi.mock("@/lib/sync", () => ({
  syncAndBuild: vi.fn().mockResolvedValue(undefined),
}));

const getEntitlementsMock = vi.fn();
vi.mock("@/lib/entitlements", () => ({
  getEntitlements: (...args: unknown[]) => getEntitlementsMock(...args),
}));

import { estimateTokens } from "@/lib/tokens";
import { writePage, restorePageVersion } from "@/lib/pages";

const UNLIMITED = { maxMembers: Number.POSITIVE_INFINITY, maxBrainTokens: Number.POSITIVE_INFINITY };

// restore_page_version (src/app/api/mcp/stream/route.ts) used to build a
// PageVersion directly, bypassing _writePageInternal — this bug meant a
// restore never restamped Page.tokenCount, never ran the brain-cap check,
// and never triggered inline version pruning. It's now routed through
// restorePageVersion (@/lib/pages), which funnels into the same
// _writePageInternal choke point as writePage/writePageJson.
describe("restorePageVersion — routed through the _writePageInternal choke point", () => {
  let orgId: string;
  let orgSlug: string;

  beforeEach(async () => {
    getEntitlementsMock.mockReset();
    getEntitlementsMock.mockResolvedValue(UNLIMITED);
    const org = await createTestOrg({ name: "Restore Cap Org", slug: `restore-cap-org-${Math.random().toString(36).slice(2)}` });
    orgId = org.id;
    orgSlug = org.slug;
  });

  afterEach(() => {
    getEntitlementsMock.mockReset();
  });

  it("errors cleanly when the page does not exist", async () => {
    const result = await restorePageVersion(orgId, orgSlug, "no-such-page", "v1", "user1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/page not found/);
  });

  it("errors cleanly when the version id does not belong to the page", async () => {
    const small = "title: Small\nshell: document\ncomponents: []\n";
    await writePage(orgId, orgSlug, "restore-target", small, "user1");
    const result = await restorePageVersion(orgId, orgSlug, "restore-target", "no-such-version", "user1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/version not found/);
  });

  it("restamps tokenCount to match the restored version's content, not the pre-restore content", async () => {
    const small = "title: Small\nshell: document\ncomponents: []\n";
    await writePage(orgId, orgSlug, "restore-restamp", small, "user1");
    const page = await testDb.page.findUnique({ where: { orgId_slug: { orgId, slug: "restore-restamp" } }, include: { versions: true } });
    const v1 = page!.versions[0];

    const bigger = small + "body: " + "x".repeat(400) + "\n";
    await writePage(orgId, orgSlug, "restore-restamp", bigger, "user1");

    const afterGrowth = await testDb.page.findUnique({ where: { id: page!.id } });
    expect(afterGrowth!.tokenCount).toBe(estimateTokens(bigger));

    // Restore back to the small version — tokenCount must restamp to the
    // *restored* content's size, not stay stale at the bigger version's size.
    const result = await restorePageVersion(orgId, orgSlug, "restore-restamp", v1.id, "reviewer1");
    expect(result.ok).toBe(true);

    const afterRestore = await testDb.page.findUnique({ where: { id: page!.id } });
    expect(afterRestore!.tokenCount).toBe(estimateTokens(small));
  });

  it("still creates a new PageVersion row for the restore (audit/version behavior preserved)", async () => {
    const small = "title: Small\nshell: document\ncomponents: []\n";
    await writePage(orgId, orgSlug, "restore-versions", small, "user1");
    const page = await testDb.page.findUnique({ where: { orgId_slug: { orgId, slug: "restore-versions" } }, include: { versions: true } });
    const v1 = page!.versions[0];

    const bigger = small + "body: " + "y".repeat(400) + "\n";
    await writePage(orgId, orgSlug, "restore-versions", bigger, "user1");

    const beforeCount = await testDb.pageVersion.count({ where: { pageId: page!.id } });
    expect(beforeCount).toBe(2);

    const result = await restorePageVersion(orgId, orgSlug, "restore-versions", v1.id, "reviewer1");
    expect(result.ok).toBe(true);

    const versions = await testDb.pageVersion.findMany({
      where: { pageId: page!.id },
      orderBy: { createdAt: "desc" },
    });
    expect(versions).toHaveLength(3);
    expect(versions[0].yamlContent).toBe(small);
    expect(versions[0].createdBy).toBe("reviewer1");
  });

  it("a shrinking restore always succeeds even when the org is already over its brain cap", async () => {
    const big = "title: Big\nshell: document\ncomponents: []\nbody: " + "v".repeat(400) + "\n";
    await writePage(orgId, orgSlug, "restore-shrink", big, "user1");
    const page = await testDb.page.findUnique({ where: { orgId_slug: { orgId, slug: "restore-shrink" } }, include: { versions: true } });
    const bigVersion = page!.versions[0];

    const bigger = big + "extra: " + "w".repeat(2000) + "\n";
    await writePage(orgId, orgSlug, "restore-shrink", bigger, "user1");

    // Org is now far over a very low cap — restoring back to the earlier,
    // smaller `big` version (still bigger than the cap on its own, but
    // strictly smaller than the current `bigger` content) must succeed
    // regardless, per the same shrinking-writes-always-pass rule as any
    // other write.
    getEntitlementsMock.mockResolvedValue({ maxMembers: Number.POSITIVE_INFINITY, maxBrainTokens: 10 });

    const result = await restorePageVersion(orgId, orgSlug, "restore-shrink", bigVersion.id, "reviewer1");
    expect(result.ok).toBe(true);

    const afterRestore = await testDb.page.findUnique({ where: { id: page!.id } });
    expect(afterRestore!.tokenCount).toBe(estimateTokens(big));
  });

  it("a growing restore that would push the org over its cap is blocked with the normal write error shape", async () => {
    const small = "title: Small\nshell: document\ncomponents: []\n";
    const smallTokens = estimateTokens(small);
    await writePage(orgId, orgSlug, "restore-grow", small, "user1");
    const page = await testDb.page.findUnique({ where: { orgId_slug: { orgId, slug: "restore-grow" } }, include: { versions: true } });
    const smallVersionId = page!.versions[0].id;

    const bigger = small + "body: " + "z".repeat(2000) + "\n";
    await writePage(orgId, orgSlug, "restore-grow", bigger, "user1");

    // Restore back to `small` first so current content is small again...
    await restorePageVersion(orgId, orgSlug, "restore-grow", smallVersionId, "user1");

    // ...then cap the org just above the small footprint and try to restore
    // forward to the bigger version — a growing restore past the cap.
    getEntitlementsMock.mockResolvedValue({ maxMembers: Number.POSITIVE_INFINITY, maxBrainTokens: smallTokens + 5 });

    const biggerVersion = await testDb.pageVersion.findFirst({
      where: { pageId: page!.id, yamlContent: bigger },
    });
    expect(biggerVersion).not.toBeNull();

    const result = await restorePageVersion(orgId, orgSlug, "restore-grow", biggerVersion!.id, "user1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/tokens/i);
      expect(result.error).toMatch(/upgrade/i);
    }

    // Nothing was written by the blocked restore — page still on the small content.
    const afterBlock = await testDb.page.findUnique({ where: { id: page!.id } });
    expect(afterBlock!.tokenCount).toBe(smallTokens);
    const versionsAfterBlock = await testDb.pageVersion.count({ where: { pageId: page!.id } });
    // 1 (small) + 1 (bigger) + 1 (restore-to-small) = 3, unaffected by the blocked attempt
    expect(versionsAfterBlock).toBe(3);
  });
});
