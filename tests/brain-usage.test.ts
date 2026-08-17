import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { testDb } from "./setup";
import { createTestOrg } from "./helpers";

// Mock db to use test database
vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});

// No file system / background-build side effects.
vi.mock("@/lib/kazam", async () => {
  const os = await import("os");
  const path = await import("path");
  const tmpDir = path.join(os.tmpdir(), `curata-test-brain-${process.pid}`);
  return {
    sitePath: () => tmpDir,
    buildSite: vi.fn().mockResolvedValue(""),
    validateContent: vi.fn().mockResolvedValue([]),
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
import { writePage, getBrainUsage } from "@/lib/pages";

const UNLIMITED = { maxMembers: Number.POSITIVE_INFINITY, maxBrainTokens: Number.POSITIVE_INFINITY };

const SMALL_YAML = `title: Small\nshell: document\ncomponents: []\n`;

describe("estimateTokens", () => {
  it("is chars/4, floored — the same substrate as the knowledge graph", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcdefg")).toBe(1); // 7 chars -> floor(7/4) = 1
    expect(estimateTokens("abcdefgh")).toBe(2);
  });
});

describe("brain usage — token accounting on writes", () => {
  let orgId: string;
  let orgSlug: string;

  beforeEach(async () => {
    getEntitlementsMock.mockReset();
    getEntitlementsMock.mockResolvedValue(UNLIMITED);
    const org = await createTestOrg({ name: "Brain Org", slug: `brain-org-${Math.random().toString(36).slice(2)}` });
    orgId = org.id;
    orgSlug = org.slug;
  });

  it("sets tokenCount on the page when a new page is created", async () => {
    const result = await writePage(orgId, orgSlug, "tok-new", SMALL_YAML, "user1");
    expect(result.ok).toBe(true);

    const page = await testDb.page.findUnique({ where: { orgId_slug: { orgId, slug: "tok-new" } } });
    expect(page!.tokenCount).toBe(estimateTokens(SMALL_YAML));
  });

  it("updates tokenCount on subsequent writes", async () => {
    await writePage(orgId, orgSlug, "tok-update", SMALL_YAML, "user1");
    const bigger = SMALL_YAML + "extra: " + "x".repeat(400) + "\n";
    await writePage(orgId, orgSlug, "tok-update", bigger, "user1");

    const page = await testDb.page.findUnique({ where: { orgId_slug: { orgId, slug: "tok-update" } } });
    expect(page!.tokenCount).toBe(estimateTokens(bigger));
  });

  it("lazily backfills tokenCount for pre-existing null rows when usage is queried", async () => {
    // Simulate a page written before the tokenCount column existed: create it
    // directly against the test db with a null tokenCount.
    const content = "title: Legacy\nshell: document\ncomponents: []\n";
    const page = await testDb.page.create({
      data: {
        orgId,
        slug: "legacy-page",
        title: "Legacy",
        createdBy: "user1",
        versions: { create: { yamlContent: content, contentHash: "deadbeef", createdBy: "user1" } },
      },
    });
    expect(page.tokenCount).toBeNull();

    const usage = await getBrainUsage(orgId);
    expect(usage).toBe(estimateTokens(content));

    const backfilled = await testDb.page.findUnique({ where: { id: page.id } });
    expect(backfilled!.tokenCount).toBe(estimateTokens(content));
  });

  it("getBrainUsage excludes archived pages", async () => {
    await writePage(orgId, orgSlug, "active-page", SMALL_YAML, "user1");
    const archivedContent = SMALL_YAML + "extra: " + "y".repeat(4000) + "\n";
    await writePage(orgId, orgSlug, "archived-page", archivedContent, "user1");
    await testDb.page.update({
      where: { orgId_slug: { orgId, slug: "archived-page" } },
      data: { status: "archived" },
    });

    const usage = await getBrainUsage(orgId);
    expect(usage).toBe(estimateTokens(SMALL_YAML));
  });

  it("getBrainUsage excludes curata-managed pages in locked folders", async () => {
    await writePage(orgId, orgSlug, "own-page", SMALL_YAML, "user1");
    const folder = await testDb.folder.create({
      data: { orgId, name: "Docs", locked: true, createdBy: "system" },
    });
    const seededContent = SMALL_YAML + "extra: " + "z".repeat(4000) + "\n";
    await writePage(orgId, orgSlug, "seeded-doc", seededContent, "system");
    await testDb.page.update({
      where: { orgId_slug: { orgId, slug: "seeded-doc" } },
      data: { folderId: folder.id },
    });

    const usage = await getBrainUsage(orgId);
    expect(usage).toBe(estimateTokens(SMALL_YAML));
  });
});

describe("brain cap enforcement — writePage rejects growing writes over the cap", () => {
  let orgId: string;
  let orgSlug: string;

  beforeEach(async () => {
    getEntitlementsMock.mockReset();
    const org = await createTestOrg({ name: "Capped Brain Org", slug: `capped-brain-org-${Math.random().toString(36).slice(2)}` });
    orgId = org.id;
    orgSlug = org.slug;
  });

  afterEach(() => {
    getEntitlementsMock.mockReset();
  });

  it("never blocks under the OSS default (unlimited)", async () => {
    getEntitlementsMock.mockResolvedValue(UNLIMITED);
    const huge = "title: Huge\nshell: document\ncomponents: []\nbody: " + "z".repeat(50_000) + "\n";
    const result = await writePage(orgId, orgSlug, "huge-page", huge, "user1");
    expect(result.ok).toBe(true);
  });

  it("rejects a growing write that would push the org over its cap", async () => {
    // Cap set just above the first page's footprint.
    const first = "title: First\nshell: document\ncomponents: []\n";
    const firstTokens = estimateTokens(first);
    getEntitlementsMock.mockResolvedValue({ maxMembers: Number.POSITIVE_INFINITY, maxBrainTokens: firstTokens + 5 });

    const created = await writePage(orgId, orgSlug, "boundary-page", first, "user1");
    expect(created.ok).toBe(true);

    // Growing this same page well past the remaining headroom should be rejected.
    const bigger = first + "extra: " + "w".repeat(200) + "\n";
    const grown = await writePage(orgId, orgSlug, "boundary-page", bigger, "user1");
    expect(grown.ok).toBe(false);
    if (!grown.ok) {
      expect(grown.error).toMatch(/tokens/i);
      expect(grown.error).toMatch(/upgrade/i);
    }

    // Nothing was written — still one version at the original content.
    const page = await testDb.page.findUnique({
      where: { orgId_slug: { orgId, slug: "boundary-page" } },
      include: { versions: true },
    });
    expect(page!.versions).toHaveLength(1);
    expect(page!.tokenCount).toBe(firstTokens);
  });

  it("allows a shrinking edit even when the org is already over cap", async () => {
    const big = "title: Big\nshell: document\ncomponents: []\nbody: " + "v".repeat(2000) + "\n";
    getEntitlementsMock.mockResolvedValue(UNLIMITED);
    await writePage(orgId, orgSlug, "shrink-page", big, "user1");

    // Now drop the cap far below current usage — org is already over cap.
    getEntitlementsMock.mockResolvedValue({ maxMembers: Number.POSITIVE_INFINITY, maxBrainTokens: 10 });

    const small = "title: Big\nshell: document\ncomponents: []\n";
    const result = await writePage(orgId, orgSlug, "shrink-page", small, "user1");
    expect(result.ok).toBe(true);

    const page = await testDb.page.findUnique({ where: { orgId_slug: { orgId, slug: "shrink-page" } } });
    expect(page!.tokenCount).toBe(estimateTokens(small));
  });

  it("allows creating a brand-new page when it fits under the cap", async () => {
    const content = "title: Fits\nshell: document\ncomponents: []\n";
    getEntitlementsMock.mockResolvedValue({ maxMembers: Number.POSITIVE_INFINITY, maxBrainTokens: estimateTokens(content) + 100 });
    const result = await writePage(orgId, orgSlug, "fits-page", content, "user1");
    expect(result.ok).toBe(true);
  });
});
