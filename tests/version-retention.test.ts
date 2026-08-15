import { describe, it, expect, vi, beforeEach } from "vitest";
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
  const tmpDir = path.join(os.tmpdir(), `curata-test-version-retention-${process.pid}`);
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

// version-retention stays real (importOriginal) so every test below exercises
// the actual prune/sweep logic — pruneVersions is wrapped in a vi.fn purely
// so ONE test can force it to reject without disturbing anyone else's real
// prune behavior (mockRejectedValueOnce reverts to the real implementation
// after a single call).
vi.mock("@/lib/version-retention", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/version-retention")>();
  return {
    ...actual,
    pruneVersions: vi.fn((pageId: string) => actual.pruneVersions(pageId)),
  };
});

import { writePage } from "@/lib/pages";
import { pruneVersions, sweepVersions, RETENTION_DAYS } from "@/lib/version-retention";
import { gatherDigestData } from "@/lib/digest";

const DEFAULT_YAML = "title: Test\nshell: document\ncomponents: []\n";
const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * DAY_MS);
}

async function makePage(orgId: string, slug: string, createdAt: Date) {
  return testDb.page.create({
    data: {
      orgId,
      slug,
      title: slug,
      createdBy: "test-user",
      createdAt,
      versions: {
        create: { yamlContent: DEFAULT_YAML, contentHash: `hash-${slug}-0`, createdBy: "test-user", createdAt },
      },
    },
    include: { versions: true },
  });
}

async function addVersion(pageId: string, createdAt: Date, hash: string) {
  return testDb.pageVersion.create({
    data: { pageId, yamlContent: DEFAULT_YAML, contentHash: hash, createdBy: "test-user", createdAt },
  });
}

describe("version-retention policy", () => {
  let orgId: string;
  let orgSlug: string;

  beforeEach(async () => {
    const org = await createTestOrg({ name: "Retention Org", slug: `retention-org-${Math.random().toString(36).slice(2)}` });
    orgId = org.id;
    orgSlug = org.slug;
  });

  it("policy is 30 days", () => {
    expect(RETENTION_DAYS).toBe(30);
  });

  describe("pruneVersions", () => {
    it("keeps the trusted version and the newest version at any age, deletes an aged-out intermediate", async () => {
      const page = await makePage(orgId, "policy-page", daysAgo(45));
      const v1 = page.versions[0]; // 45 days old — will be marked trusted
      const v2 = await addVersion(page.id, daysAgo(31), "v2-hash"); // stale intermediate — deleted
      const v3 = await addVersion(page.id, daysAgo(5), "v3-hash"); // fresh intermediate — kept
      const v4 = await addVersion(page.id, new Date(), "v4-hash"); // newest — kept

      await testDb.page.update({ where: { id: page.id }, data: { trustedVersionId: v1.id } });

      const deletedCount = await pruneVersions(page.id);
      expect(deletedCount).toBe(1);

      const remaining = await testDb.pageVersion.findMany({ where: { pageId: page.id }, select: { id: true } });
      const remainingIds = remaining.map((v) => v.id).sort();
      expect(remainingIds).toEqual([v1.id, v3.id, v4.id].sort());
      expect(remainingIds).not.toContain(v2.id);
    });

    it("keeps intermediate versions younger than RETENTION_DAYS even when neither trusted nor newest", async () => {
      const page = await makePage(orgId, "fresh-page", daysAgo(20));
      await addVersion(page.id, daysAgo(10), "fresh-v2");
      await addVersion(page.id, new Date(), "fresh-v3");

      const deletedCount = await pruneVersions(page.id);
      expect(deletedCount).toBe(0);

      const remaining = await testDb.pageVersion.findMany({ where: { pageId: page.id } });
      expect(remaining).toHaveLength(3);
    });

    it("no-ops for a page id that doesn't exist", async () => {
      const deletedCount = await pruneVersions("does-not-exist");
      expect(deletedCount).toBe(0);
    });
  });

  describe("write path (_writePageInternal)", () => {
    it("prunes an aged-out intermediate inline after a normal write", async () => {
      const page = await makePage(orgId, "inline-prune-page", daysAgo(40));
      await addVersion(page.id, daysAgo(31), "inline-v2"); // will be the newest until the write below lands

      const result = await writePage(orgId, orgSlug, "inline-prune-page", "title: V3\nshell: document\ncomponents: []\n", "user1");
      expect(result.ok).toBe(true);

      // The write created a brand-new "newest" version, so the 31-day-old
      // version is no longer immune and should have been pruned inline.
      const remaining = await testDb.pageVersion.findMany({ where: { pageId: page.id }, select: { contentHash: true } });
      expect(remaining.map((v) => v.contentHash)).not.toContain("inline-v2");
    });

    it("does not fail the write when pruneVersions throws", async () => {
      vi.mocked(pruneVersions).mockRejectedValueOnce(new Error("boom"));
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await writePage(orgId, orgSlug, "prune-throws-page", DEFAULT_YAML, "user1");
      expect(result.ok).toBe(true);

      const page = await testDb.page.findUnique({
        where: { orgId_slug: { orgId, slug: "prune-throws-page" } },
        include: { versions: true },
      });
      expect(page).not.toBeNull();
      expect(page!.versions).toHaveLength(1);
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe("sweepVersions", () => {
    it("prunes aged-out intermediates across every page in the org", async () => {
      // v1 on each page is deliberately recent so it isn't itself stale —
      // isolates the count to exactly the one aged-out intermediate per page.
      const pageA = await makePage(orgId, "sweep-a", daysAgo(3));
      const aStale = await addVersion(pageA.id, daysAgo(35), "sweep-a-v2");
      await addVersion(pageA.id, new Date(), "sweep-a-v3");

      const pageB = await makePage(orgId, "sweep-b", daysAgo(2));
      const bStale = await addVersion(pageB.id, daysAgo(31), "sweep-b-v2");
      await addVersion(pageB.id, daysAgo(1), "sweep-b-v3");

      const deletedCount = await sweepVersions(orgId);
      expect(deletedCount).toBe(2);

      const remainingA = await testDb.pageVersion.findMany({ where: { pageId: pageA.id }, select: { id: true } });
      expect(remainingA.map((v) => v.id)).not.toContain(aStale.id);

      const remainingB = await testDb.pageVersion.findMany({ where: { pageId: pageB.id }, select: { id: true } });
      expect(remainingB.map((v) => v.id)).not.toContain(bStale.id);
    });

    it("only sweeps the requested org's pages", async () => {
      const otherOrg = await createTestOrg({ name: "Other Retention Org", slug: `other-retention-org-${Math.random().toString(36).slice(2)}` });
      const otherPage = await makePage(otherOrg.id, "other-org-page", daysAgo(40));
      const otherStale = await addVersion(otherPage.id, daysAgo(35), "other-stale");
      await addVersion(otherPage.id, new Date(), "other-newest");

      await sweepVersions(orgId);

      const stillThere = await testDb.pageVersion.findUnique({ where: { id: otherStale.id } });
      expect(stillThere).not.toBeNull();
    });
  });

  describe("restore interaction", () => {
    it("a surviving version can still be looked up and restored by id after pruning; a pruned id errors cleanly", async () => {
      const page = await makePage(orgId, "restore-page", daysAgo(45));
      const v1 = page.versions[0];
      await testDb.page.update({ where: { id: page.id }, data: { trustedVersionId: v1.id } });
      const v2 = await addVersion(page.id, daysAgo(31), "restore-v2"); // stale, gets pruned
      const v3 = await addVersion(page.id, new Date(), "restore-v3"); // newest, survives

      await pruneVersions(page.id);

      // restore_page_version (src/app/api/mcp/stream/route.ts) looks a
      // version up by id + pageId, then creates a fresh version copying its
      // content — mirrored here directly against the surviving row.
      const target = await testDb.pageVersion.findFirst({ where: { id: v3.id, pageId: page.id } });
      expect(target).not.toBeNull();

      const restored = await testDb.pageVersion.create({
        data: {
          pageId: page.id,
          yamlContent: target!.yamlContent,
          jsonContent: target!.jsonContent ?? undefined,
          contentHash: "restored-hash",
          createdBy: "reviewer1",
        },
      });
      expect(restored.id).toBeTruthy();

      // get_versions / restore both key off this same lookup — a pruned id
      // simply isn't found, not a thrown error or a corrupt row.
      const prunedLookup = await testDb.pageVersion.findFirst({ where: { id: v2.id, pageId: page.id } });
      expect(prunedLookup).toBeNull();
    });
  });

  describe("digest hot spots vs. retention pruning", () => {
    it("hot-spot counting inside the 7-day digest window is unaffected by a 30-day retention sweep", async () => {
      const windowStart = daysAgo(7);
      // Anchor page whose slug marks it as a previous digest run, pinning the window.
      await makePage(orgId, "digest-2026-w-anchor", windowStart);

      const hot = await makePage(orgId, "hot-page", daysAgo(5));
      await addVersion(hot.id, daysAgo(3), "hot-v2");
      await addVersion(hot.id, daysAgo(1), "hot-v3");

      const before = await gatherDigestData(orgId, undefined, new Date());
      expect(before.hotSpots.find((h) => h.slug === "hot-page")?.versionCount).toBe(3);

      // Retention only ever removes versions older than 30 days — nothing in
      // a 7-day-old window is ever eligible, so a sweep must be a no-op here.
      await sweepVersions(orgId);

      const after = await gatherDigestData(orgId, undefined, new Date());
      expect(after.hotSpots.find((h) => h.slug === "hot-page")?.versionCount).toBe(3);
    });
  });
});
