import { describe, it, expect, vi, beforeEach } from "vitest";
import { testDb } from "./setup";
import { createTestOrg } from "./helpers";

// Mock db to use test database
vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});

// No filesystem/browser side effects from tools unrelated to digest generation.
vi.mock("@/lib/kazam", async () => {
  const os = await import("os");
  const path = await import("path");
  const tmpDir = path.join(os.tmpdir(), `curata-test-digest-${process.pid}`);
  return {
    sitePath: () => tmpDir,
    buildSite: vi.fn().mockResolvedValue(""),
    validateContent: vi.fn().mockResolvedValue([]),
    checkUnsupportedComponents: vi.fn().mockReturnValue([]),
  };
});

import {
  gatherDigestData,
  computeWindow,
  resolvePreviousDigestAt,
  isoWeek,
  digestSlug,
  digestTitle,
} from "@/lib/digest";
import { dispatch } from "@/lib/mcp-dispatch";

const PAGE_YAML = "title: t\nshell: document\ncomponents: []\n";

async function tagPage(pageId: string, term: string) {
  const concept = await testDb.concept.upsert({
    where: { normalizedName: term },
    update: {},
    create: { normalizedName: term, displayName: term, kind: "topic" },
  });
  await testDb.pageConcept.create({ data: { pageId, conceptId: concept.id, createdBy: "test-user" } });
}

async function makePage(
  orgId: string,
  slug: string,
  createdAt: Date,
  overrides: Record<string, unknown> = {}
) {
  return testDb.page.create({
    data: {
      orgId,
      slug,
      title: slug,
      createdBy: "test-user",
      createdAt,
      versions: {
        create: { yamlContent: PAGE_YAML, contentHash: `hash-${slug}-${createdAt.getTime()}`, createdBy: "test-user", createdAt },
      },
      ...overrides,
    },
    include: { versions: true },
  });
}

async function addVersion(pageId: string, createdAt: Date, hash: string) {
  return testDb.pageVersion.create({
    data: { pageId, yamlContent: PAGE_YAML, contentHash: hash, createdBy: "test-user", createdAt },
  });
}

describe("digest — window math", () => {
  it("falls back to a 7 day lookback when no previous digest exists", () => {
    const now = new Date("2026-08-14T12:00:00Z");
    const { windowStart, windowEnd } = computeWindow(null, now);
    expect(windowEnd).toEqual(now);
    expect(now.getTime() - windowStart.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("uses the previous digest run's timestamp as window start when one exists", () => {
    const now = new Date("2026-08-14T12:00:00Z");
    const previous = new Date("2026-08-10T09:00:00Z");
    const { windowStart, windowEnd } = computeWindow(previous, now);
    expect(windowStart).toEqual(previous);
    expect(windowEnd).toEqual(now);
  });

  it("derives a deterministic per-ISO-week slug and a title with no em dash", () => {
    const d = new Date("2026-08-14T00:00:00Z");
    const { year, week } = isoWeek(d);
    expect(digestSlug(d)).toBe(`digest-${year}-w${String(week).padStart(2, "0")}`);
    const title = digestTitle(d);
    expect(title).toContain(String(year));
    expect(title).not.toContain("—");
  });
});

describe("digest — resolvePreviousDigestAt", () => {
  let orgId: string;

  beforeEach(async () => {
    const org = await createTestOrg({ name: "Digest Org", slug: "digest-org" });
    orgId = org.id;
  });

  it("returns null when this org has never generated a digest", async () => {
    await makePage(orgId, "some-other-page", new Date("2026-08-01T00:00:00Z"));
    expect(await resolvePreviousDigestAt(orgId)).toBeNull();
  });

  it("returns the newest version timestamp across every digest-* page", async () => {
    const older = new Date("2026-08-01T00:00:00Z");
    const newer = new Date("2026-08-08T00:00:00Z");
    await makePage(orgId, "digest-2026-w31", older);
    await makePage(orgId, "digest-2026-w32", newer);
    // A later edit to an unrelated page must not count as a digest run.
    await makePage(orgId, "not-a-digest", new Date("2026-08-12T00:00:00Z"));

    expect(await resolvePreviousDigestAt(orgId)).toEqual(newer);
  });
});

describe("digest — gatherDigestData", () => {
  let orgId: string;
  const now = new Date("2026-08-14T00:00:00Z");
  const windowStart = new Date("2026-08-07T00:00:00Z");

  beforeEach(async () => {
    const org = await createTestOrg({ name: "Gather Org", slug: "gather-org" });
    orgId = org.id;
    // Pin the window by seeding a prior digest run at windowStart.
    await makePage(orgId, "digest-2026-w31", windowStart);
  });

  it("returns every section empty when nothing happened in the window", async () => {
    const data = await gatherDigestData(orgId, undefined, new Date(windowStart.getTime() + 1000));
    expect(data.newPagesByConcept).toEqual([]);
    expect(data.uncategorizedNewPages).toEqual([]);
    expect(data.trustFlips).toEqual([]);
    expect(data.awaitingReview).toEqual([]);
    expect(data.hotSpots).toEqual([]);
  });

  it("groups new pages by concept tag and buckets untagged pages separately", async () => {
    const inWindow = new Date(windowStart.getTime() + 60_000);
    const beforeWindow = new Date(windowStart.getTime() - 60_000);

    const priced1 = await makePage(orgId, "priced-1", inWindow);
    const priced2 = await makePage(orgId, "priced-2", inWindow);
    await tagPage(priced1.id, "pricing");
    await tagPage(priced2.id, "pricing");
    await makePage(orgId, "untagged-new", inWindow);
    // Created before the window — must not show up as "new".
    const old = await makePage(orgId, "old-tagged", beforeWindow);
    await tagPage(old.id, "pricing");

    const data = await gatherDigestData(orgId, undefined, now);

    const pricingGroup = data.newPagesByConcept.find((g) => g.concept === "pricing");
    expect(pricingGroup?.pages.map((p) => p.slug).sort()).toEqual(["priced-1", "priced-2"]);
    expect(data.uncategorizedNewPages.map((p) => p.slug)).toEqual(["untagged-new"]);
  });

  it("excludes archived pages from new pages — reuses listPagesWhere's visibility filter, not a hand-rolled one", async () => {
    const inWindow = new Date(windowStart.getTime() + 60_000);
    await makePage(orgId, "archived-new", inWindow, { status: "archived" });

    const data = await gatherDigestData(orgId, undefined, now);
    expect(data.uncategorizedNewPages.map((p) => p.slug)).not.toContain("archived-new");
  });

  it("excludes locked-folder pages from new pages and hot spots", async () => {
    // Digest pages themselves can't land in the window (windowStart is
    // derived from the newest digest version), so only the locked-folder
    // exclusion needs a live test; the slug filter is defensive.
    const inWindow = new Date(windowStart.getTime() + 60_000);
    const locked = await testDb.folder.create({
      data: { orgId, name: "Templates", locked: true, createdBy: "test-user" },
    });
    const template = await makePage(orgId, "seeded-template", inWindow, { folderId: locked.id });
    await addVersion(template.id, new Date(inWindow.getTime() + 1000), "hash-template-v2");
    await addVersion(template.id, new Date(inWindow.getTime() + 2000), "hash-template-v3");
    await makePage(orgId, "real-page", inWindow);

    const data = await gatherDigestData(orgId, undefined, now);

    expect(data.uncategorizedNewPages.map((p) => p.slug)).toEqual(["real-page"]);
    expect(data.hotSpots.map((h) => h.slug)).not.toContain("seeded-template");
  });

  it("counts distinct new pages and tagged new pages for the overview health line", async () => {
    const inWindow = new Date(windowStart.getTime() + 60_000);
    const multiTag = await makePage(orgId, "multi-tag", inWindow);
    await tagPage(multiTag.id, "pricing");
    await tagPage(multiTag.id, "sales");
    await makePage(orgId, "untagged-a", inWindow);
    await makePage(orgId, "untagged-b", inWindow);

    const data = await gatherDigestData(orgId, undefined, now);

    // multi-tag appears in two concept groups but counts once.
    expect(data.newPageCount).toBe(3);
    expect(data.taggedNewPageCount).toBe(1);

    const { buildDigestPageYaml } = await import("@/lib/digest");
    const yamlOut = buildDigestPageYaml(data, "gather-org", "Digest - Week 33, 2026");
    expect(yamlOut).toContain("3 new pages");
    expect(yamlOut).toContain("1 of 3 new pages tagged");
  });

  it("derives trust flips from AuditLog page.trust entries in the window", async () => {
    const page = await makePage(orgId, "flipped-page", new Date(windowStart.getTime() - 60_000));
    const inWindow = new Date(windowStart.getTime() + 60_000);
    const outOfWindow = new Date(windowStart.getTime() - 5000);

    await testDb.auditLog.create({
      data: {
        orgId,
        action: "page.trust",
        resourceType: "page",
        resourceId: page.slug,
        actorId: "tyler",
        createdAt: inWindow,
        metadata: { versionId: page.versions[0].id },
      },
    });
    // Before the window — must not be picked up.
    await testDb.auditLog.create({
      data: {
        orgId,
        action: "page.trust",
        resourceType: "page",
        resourceId: page.slug,
        actorId: "someone-else",
        createdAt: outOfWindow,
      },
    });
    // A different action on the same page in-window must not count as a flip.
    await testDb.auditLog.create({
      data: {
        orgId,
        action: "page.untrust",
        resourceType: "page",
        resourceId: page.slug,
        actorId: "tyler",
        createdAt: inWindow,
      },
    });

    const data = await gatherDigestData(orgId, undefined, now);
    expect(data.trustFlips).toHaveLength(1);
    expect(data.trustFlips[0]).toMatchObject({ slug: "flipped-page", actorId: "tyler" });
  });

  it("lists only trustedBehind pages under awaiting review, not never-trusted pages", async () => {
    const inWindow = new Date(windowStart.getTime() + 60_000);
    const behind = await makePage(orgId, "behind-page", inWindow);
    await addVersion(behind.id, new Date(inWindow.getTime() + 1000), "behind-page-v2");
    await testDb.page.update({ where: { id: behind.id }, data: { trustedVersionId: behind.versions[0].id } });

    await makePage(orgId, "never-trusted-page", inWindow);

    const data = await gatherDigestData(orgId, undefined, now);
    const slugs = data.awaitingReview.map((r) => r.slug);
    expect(slugs).toContain("behind-page");
    expect(slugs).not.toContain("never-trusted-page");
  });

  it("surfaces hot spots only for pages edited more than once in the window", async () => {
    const inWindow = new Date(windowStart.getTime() + 60_000);
    const hot = await makePage(orgId, "hot-page", inWindow);
    await addVersion(hot.id, new Date(inWindow.getTime() + 1000), "hot-page-v2");
    await addVersion(hot.id, new Date(inWindow.getTime() + 2000), "hot-page-v3");
    await makePage(orgId, "single-edit-page", inWindow);

    const data = await gatherDigestData(orgId, undefined, now);
    const hotSlugs = data.hotSpots.map((h) => h.slug);
    expect(hotSlugs).toContain("hot-page");
    expect(hotSlugs).not.toContain("single-edit-page");
    expect(data.hotSpots.find((h) => h.slug === "hot-page")?.versionCount).toBe(3);
  });
});

describe("MCP dispatch — generate_digest", () => {
  let orgId: string;
  let orgSlug: string;

  beforeEach(async () => {
    const org = await createTestOrg({ name: "Digest Dispatch Org", slug: "digest-dispatch-org" });
    orgId = org.id;
    orgSlug = org.slug;
  });

  it("creates the digest page in an auto-created Digests folder", async () => {
    const result = (await dispatch(
      "generate_digest",
      {},
      orgId,
      orgSlug,
      "apikey-1",
      "user-1"
    )) as { ok: boolean; slug: string; folderId: string; created: boolean };

    expect(result.ok).toBe(true);
    expect(result.created).toBe(true);

    const folder = await testDb.folder.findFirst({ where: { orgId, name: "Digests" } });
    expect(folder).toBeTruthy();
    expect(result.folderId).toBe(folder?.id);

    const page = await testDb.page.findUnique({ where: { orgId_slug: { orgId, slug: result.slug } } });
    expect(page?.folderId).toBe(folder?.id);
  });

  it("updates the existing same-window page on a second call instead of duplicating it", async () => {
    const first = (await dispatch(
      "generate_digest",
      {},
      orgId,
      orgSlug,
      "apikey-1",
      "user-1"
    )) as { slug: string; created: boolean };
    expect(first.created).toBe(true);

    const second = (await dispatch(
      "generate_digest",
      {},
      orgId,
      orgSlug,
      "apikey-1",
      "user-1"
    )) as { slug: string; created: boolean };
    expect(second.slug).toBe(first.slug);
    expect(second.created).toBe(false);

    const pages = await testDb.page.findMany({ where: { orgId, slug: { startsWith: "digest-" } } });
    expect(pages).toHaveLength(1);

    const versions = await testDb.pageVersion.findMany({ where: { pageId: pages[0].id } });
    expect(versions).toHaveLength(2);

    const folders = await testDb.folder.findMany({ where: { orgId, name: "Digests" } });
    expect(folders).toHaveLength(1);
  });

  it("tags the digest page with the digest concept", async () => {
    const result = (await dispatch(
      "generate_digest",
      {},
      orgId,
      orgSlug,
      "apikey-1",
      "user-1"
    )) as { slug: string };

    const page = await testDb.page.findUnique({ where: { orgId_slug: { orgId, slug: result.slug } } });
    const tags = await testDb.pageConcept.findMany({
      where: { pageId: page!.id },
      select: { concept: { select: { normalizedName: true } } },
    });
    expect(tags.map((t) => t.concept.normalizedName)).toContain("digest");
  });
});
