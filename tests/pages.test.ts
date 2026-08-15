import { describe, it, expect, vi, beforeEach } from "vitest";
import { testDb } from "./setup";
import { createTestOrg } from "./helpers";

// Mock db module to use the test database instance
vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});

// Mock kazam — no file system side-effects
vi.mock("@/lib/kazam", async () => {
  const os = await import("os");
  const path = await import("path");
  const tmpDir = path.join(os.tmpdir(), `curata-test-pages-${process.pid}`);
  return {
    sitePath: () => tmpDir,
    buildSite: vi.fn().mockResolvedValue(""),
    validateContent: vi.fn().mockResolvedValue([]),
  };
});

// Mock sync — no background builds during tests
vi.mock("@/lib/sync", () => ({
  syncAndBuild: vi.fn().mockResolvedValue(undefined),
}));

import {
  listPages,
  readPage,
  readPageYaml,
  writePage,
  searchPages,
  saveAnnotation,
  getAnnotations,
  updateAnnotationStatus,
  markTrusted,
  clearTrusted,
  getPageSections,
  getReviewQueue,
  getReviewQueueCount,
} from "@/lib/pages";

const DEFAULT_YAML = `title: Test Page
shell: document
components: []
`;

describe("pages", () => {
  let orgId: string;
  let orgSlug: string;

  beforeEach(async () => {
    const org = await createTestOrg({ name: "Pages Test Org", slug: "pages-test-org" });
    orgId = org.id;
    orgSlug = org.slug;
  });

  describe("writePage", () => {
    it("creates a page and version", async () => {
      const result = await writePage(orgId, orgSlug, "new-page", DEFAULT_YAML, "user1");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.slug).toBe("new-page");
      expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);

      const page = await testDb.page.findUnique({
        where: { orgId_slug: { orgId, slug: "new-page" } },
        include: { versions: true },
      });
      expect(page).not.toBeNull();
      expect(page!.versions).toHaveLength(1);
      expect(page!.versions[0].yamlContent).toBe(DEFAULT_YAML);
    });

    it("returns early (dedup) when content is unchanged", async () => {
      await writePage(orgId, orgSlug, "dedup-page", DEFAULT_YAML, "user1");
      const result = await writePage(orgId, orgSlug, "dedup-page", DEFAULT_YAML, "user1");
      expect(result.ok).toBe(true);

      // Still only one version
      const page = await testDb.page.findUnique({
        where: { orgId_slug: { orgId, slug: "dedup-page" } },
        include: { versions: true },
      });
      expect(page!.versions).toHaveLength(1);
    });

    it("stamps component IDs on save", async () => {
      const yamlContent = `title: ID Test
shell: standard
components:
- type: section
  eyebrow: Topic 1
  heading: My Section
  components: []
- type: divider
`;
      const result = await writePage(orgId, orgSlug, "id-stamp-page", yamlContent, "user1");
      expect(result.ok).toBe(true);

      const read = await readPageYaml(orgId, "id-stamp-page");
      expect(read).not.toBeNull();
      expect(read!.yaml).toContain("id: topic-1-my-section");
      expect(read!.yaml).toContain("id: divider-1");
    });

    it("detects conflicts when expectedHash does not match", async () => {
      await writePage(orgId, orgSlug, "conflict-page", DEFAULT_YAML, "user1");

      const result = await writePage(
        orgId,
        orgSlug,
        "conflict-page",
        "title: Different\nshell: document\ncomponents: []\n",
        "user1",
        "not-the-real-hash"
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/conflict/);
    });
  });

  describe("listPages", () => {
    it("returns page metadata for org", async () => {
      await writePage(orgId, orgSlug, "list-page-1", DEFAULT_YAML, "user1");
      await writePage(
        orgId,
        orgSlug,
        "list-page-2",
        "title: Page 2\nshell: document\ncomponents: []\n",
        "user1"
      );

      const pages = await listPages(orgId);
      const slugs = pages.map((p) => p.slug);
      expect(slugs).toContain("list-page-1");
      expect(slugs).toContain("list-page-2");
      for (const p of pages) {
        expect(p).toHaveProperty("title");
        expect(p).toHaveProperty("visibility");
        expect(p).toHaveProperty("annotationCount");
        expect(p).toHaveProperty("updatedAt");
      }
    });
  });

  describe("readPageYaml", () => {
    it("returns yaml content and hash", async () => {
      await writePage(orgId, orgSlug, "read-page", DEFAULT_YAML, "user1");
      const result = await readPageYaml(orgId, "read-page");
      expect(result).not.toBeNull();
      expect(result!.yaml).toBe(DEFAULT_YAML);
      expect(result!.contentHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("returns null for unknown page", async () => {
      const result = await readPageYaml(orgId, "does-not-exist");
      expect(result).toBeNull();
    });
  });

  describe("searchPages", () => {
    it("finds pages matching query", async () => {
      await writePage(
        orgId,
        orgSlug,
        "searchable-page",
        "title: Unicorn Page\nshell: document\ncomponents: []\n",
        "user1"
      );

      const results = await searchPages(orgId, "unicorn");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].slug).toBe("searchable-page");
      expect(results[0].matches.length).toBeGreaterThan(0);
    });

    it("returns empty for no match", async () => {
      const results = await searchPages(orgId, "zzznomatch999");
      expect(results).toHaveLength(0);
    });

    it("falls back to salient-term matching when the literal multi-word query misses an exact-titled page", async () => {
      await writePage(
        orgId,
        orgSlug,
        "getting-started",
        "title: Getting Started with Curata\nshell: document\ncomponents:\n  - type: markdown\n    body: From empty brain to running loop.\n",
        "user1"
      );

      // No page contains this exact phrase verbatim, so the literal
      // whole-query substring pass finds nothing — the fallback should still
      // surface the obviously-relevant page via shared distinctive terms.
      const results = await searchPages(orgId, "getting started onboarding");
      expect(results.some((r) => r.slug === "getting-started")).toBe(true);
    });

    it("keeps literal-first behavior for a query that matches verbatim", async () => {
      await writePage(
        orgId,
        orgSlug,
        "verbatim-page",
        "title: Exact Phrase Page\nshell: document\ncomponents:\n  - type: markdown\n    body: this exact phrase appears here\n",
        "user1"
      );
      const results = await searchPages(orgId, "this exact phrase appears here");
      expect(results.some((r) => r.slug === "verbatim-page")).toBe(true);
    });

    it("does not fall back to noise for a nonsense query with no shared terms", async () => {
      await writePage(
        orgId,
        orgSlug,
        "unrelated-fallback-page",
        "title: Completely Different Topic\nshell: document\ncomponents:\n  - type: markdown\n    body: nothing to do with the query\n",
        "user1"
      );
      const results = await searchPages(orgId, "zzznomatch999 qqqnothingmatches888");
      expect(results).toHaveLength(0);
    });
  });

  describe("trust channel", () => {
    async function versionIdsDesc(slug: string): Promise<string[]> {
      const page = await testDb.page.findUnique({
        where: { orgId_slug: { orgId, slug } },
        include: { versions: { orderBy: { createdAt: "desc" } } },
      });
      return page!.versions.map((v) => v.id);
    }

    it("serves the trusted pointer while latest moves ahead, and labels both channels", async () => {
      await writePage(orgId, orgSlug, "trust-page", "title: V1\nshell: document\ncomponents: []\n", "user1");
      const [v1Id] = await versionIdsDesc("trust-page");

      const mark = await markTrusted(orgId, "trust-page", v1Id, "reviewer1");
      expect(mark.ok).toBe(true);

      await writePage(orgId, orgSlug, "trust-page", "title: V2\nshell: document\ncomponents: []\n", "user1");

      const trusted = await readPageYaml(orgId, "trust-page", "trusted");
      expect(trusted).not.toBeNull();
      expect(trusted!.yaml).toContain("V1");
      expect(trusted!.trusted).toBe(true);
      expect(trusted!.trustedBehind).toBe(true);

      const latest = await readPageYaml(orgId, "trust-page", "latest");
      expect(latest).not.toBeNull();
      expect(latest!.yaml).toContain("V2");
      expect(latest!.trusted).toBe(false);
      expect(latest!.trustedBehind).toBe(true);
    });

    it("falls back to latest labeled untrusted when nothing has been marked", async () => {
      await writePage(orgId, orgSlug, "untrusted-page", DEFAULT_YAML, "user1");

      const result = await readPageYaml(orgId, "untrusted-page", "trusted");
      expect(result).not.toBeNull();
      expect(result!.yaml).toBe(DEFAULT_YAML);
      expect(result!.trusted).toBe(false);
      expect(result!.trustedBehind).toBe(false);
    });

    it("readPage carries the same trust labels as readPageYaml", async () => {
      await writePage(orgId, orgSlug, "trust-json-page", DEFAULT_YAML, "user1");
      const result = await readPage(orgId, "trust-json-page", "trusted");
      expect(result).not.toBeNull();
      expect(result!.trusted).toBe(false);
      expect(result!.trustedBehind).toBe(false);
    });

    it("reflects trust state in listPages and searchPages results", async () => {
      await writePage(orgId, orgSlug, "trust-list-page", "title: Findable\nshell: document\ncomponents: []\n", "user1");
      const [v1Id] = await versionIdsDesc("trust-list-page");
      await markTrusted(orgId, "trust-list-page", v1Id, "reviewer1");
      await writePage(orgId, orgSlug, "trust-list-page", "title: Findable V2\nshell: document\ncomponents: []\n", "user1");

      const listed = await listPages(orgId, undefined, "trusted");
      const entry = listed.find((p) => p.slug === "trust-list-page");
      expect(entry).toBeDefined();
      expect(entry!.trusted).toBe(true);
      expect(entry!.trustedBehind).toBe(true);

      const searched = await searchPages(orgId, "findable", undefined, {}, "trusted");
      const found = searched.find((r) => r.slug === "trust-list-page");
      expect(found).toBeDefined();
      expect(found!.trusted).toBe(true);
      expect(found!.trustedBehind).toBe(true);
    });

    it("logs an audit entry when a version is marked trusted", async () => {
      await writePage(orgId, orgSlug, "audit-trust-page", DEFAULT_YAML, "user1");
      const [v1Id] = await versionIdsDesc("audit-trust-page");

      const result = await markTrusted(orgId, "audit-trust-page", v1Id, "reviewer1");
      expect(result.ok).toBe(true);

      const entries = await testDb.auditLog.findMany({
        where: { orgId, action: "page.trust", resourceId: "audit-trust-page" },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0].actorId).toBe("reviewer1");
      const metadata = entries[0].metadata as { versionId?: string };
      expect(metadata.versionId).toBe(v1Id);
    });

    it("logs an audit entry when trust is cleared", async () => {
      await writePage(orgId, orgSlug, "audit-untrust-page", DEFAULT_YAML, "user1");
      const [v1Id] = await versionIdsDesc("audit-untrust-page");
      await markTrusted(orgId, "audit-untrust-page", v1Id, "reviewer1");

      const result = await clearTrusted(orgId, "audit-untrust-page", "reviewer1");
      expect(result.ok).toBe(true);

      const page = await testDb.page.findUnique({ where: { orgId_slug: { orgId, slug: "audit-untrust-page" } } });
      expect(page!.trustedVersionId).toBeNull();

      const entries = await testDb.auditLog.findMany({
        where: { orgId, action: "page.untrust", resourceId: "audit-untrust-page" },
      });
      expect(entries).toHaveLength(1);
    });

    it("returns an error when marking a version that doesn't belong to the page", async () => {
      await writePage(orgId, orgSlug, "wrong-version-page-a", DEFAULT_YAML, "user1");
      await writePage(orgId, orgSlug, "wrong-version-page-b", DEFAULT_YAML, "user1");
      const [bVersionId] = await versionIdsDesc("wrong-version-page-b");

      const result = await markTrusted(orgId, "wrong-version-page-a", bVersionId, "reviewer1");
      expect(result.ok).toBe(false);
    });
  });

  describe("saveAnnotation", () => {
    it("creates an annotation on a page", async () => {
      await writePage(orgId, orgSlug, "ann-page", DEFAULT_YAML, "user1");
      const ann = await saveAnnotation(orgId, orgSlug, "ann-page", "Fix this", "reviewer1");
      expect(ann.id).toBeTruthy();
      expect(ann.text).toBe("Fix this");
      expect(ann.author).toBe("reviewer1");
      expect(ann.status).toBe("pending");
    });

    it("throws for unknown page", async () => {
      await expect(
        saveAnnotation(orgId, orgSlug, "ghost-page", "note", "user1")
      ).rejects.toThrow("page not found");
    });
  });

  describe("getAnnotations", () => {
    it("returns annotations for a page", async () => {
      await writePage(orgId, orgSlug, "get-ann-page", DEFAULT_YAML, "user1");
      await saveAnnotation(orgId, orgSlug, "get-ann-page", "First note", "user1");
      await saveAnnotation(orgId, orgSlug, "get-ann-page", "Second note", "user2");

      const anns = await getAnnotations(orgId, "get-ann-page");
      expect(anns).toHaveLength(2);
      expect(anns.map((a) => a.text)).toContain("First note");
      expect(anns.map((a) => a.text)).toContain("Second note");
    });

    it("returns empty for page with no annotations", async () => {
      await writePage(orgId, orgSlug, "no-ann-page", DEFAULT_YAML, "user1");
      const anns = await getAnnotations(orgId, "no-ann-page");
      expect(anns).toHaveLength(0);
    });
  });

  describe("updateAnnotationStatus", () => {
    it("changes annotation status", async () => {
      await writePage(orgId, orgSlug, "status-page", DEFAULT_YAML, "user1");
      const ann = await saveAnnotation(orgId, orgSlug, "status-page", "Review this", "user1");

      const ok = await updateAnnotationStatus(orgId, orgSlug, "status-page", ann.id, "approved");
      expect(ok).toBe(true);

      const updated = await testDb.annotation.findUnique({ where: { id: ann.id } });
      expect(updated!.status).toBe("approved");
    });

    it("returns false for unknown annotation", async () => {
      await writePage(orgId, orgSlug, "status-page2", DEFAULT_YAML, "user1");
      const ok = await updateAnnotationStatus(
        orgId,
        orgSlug,
        "status-page2",
        "non-existent-id",
        "approved"
      );
      expect(ok).toBe(false);
    });
  });

  describe("getPageSections channel alignment", () => {
    const V1 = "title: V1\nshell: document\ncomponents:\n  - type: section\n    heading: First\n";
    const V2 = "title: V2\nshell: document\ncomponents:\n  - type: section\n    heading: First\n  - type: section\n    heading: Second\n";

    async function versionIdsDesc(slug: string): Promise<string[]> {
      const page = await testDb.page.findUnique({
        where: { orgId_slug: { orgId, slug } },
        include: { versions: { orderBy: { createdAt: "desc" } } },
      });
      return page!.versions.map((v) => v.id);
    }

    it("computes sections against the trusted version, not always latest", async () => {
      await writePage(orgId, orgSlug, "sections-page", V1, "user1");
      const [v1Id] = await versionIdsDesc("sections-page");
      await markTrusted(orgId, "sections-page", v1Id, "reviewer1");
      await writePage(orgId, orgSlug, "sections-page", V2, "user1");

      const trustedSections = await getPageSections(orgId, "sections-page", "trusted");
      expect(trustedSections).toEqual(["First"]);

      const latestSections = await getPageSections(orgId, "sections-page", "latest");
      expect(latestSections).toEqual(["First", "Second"]);
    });

    it("defaults to latest when no channel is passed", async () => {
      await writePage(orgId, orgSlug, "sections-default-page", V2, "user1");
      const sections = await getPageSections(orgId, "sections-default-page");
      expect(sections).toEqual(["First", "Second"]);
    });
  });

  describe("review queue", () => {
    async function versionIdsDesc(slug: string): Promise<string[]> {
      const page = await testDb.page.findUnique({
        where: { orgId_slug: { orgId, slug } },
        include: { versions: { orderBy: { createdAt: "desc" } } },
      });
      return page!.versions.map((v) => v.id);
    }

    it("includes pages that have never been trusted", async () => {
      await writePage(orgId, orgSlug, "never-trusted-page", DEFAULT_YAML, "user1");

      const queue = await getReviewQueue(orgId);
      const entry = queue.find((r) => r.slug === "never-trusted-page");
      expect(entry).toBeDefined();
      expect(entry!.neverTrusted).toBe(true);
      expect(entry!.versionsBehind).toBe(1);
    });

    it("includes pages whose trusted pointer has fallen behind latest", async () => {
      await writePage(orgId, orgSlug, "behind-page", "title: V1\nshell: document\ncomponents: []\n", "user1");
      const [v1Id] = await versionIdsDesc("behind-page");
      await markTrusted(orgId, "behind-page", v1Id, "reviewer1");
      await writePage(orgId, orgSlug, "behind-page", "title: V2\nshell: document\ncomponents: []\n", "user1");
      await writePage(orgId, orgSlug, "behind-page", "title: V3\nshell: document\ncomponents: []\n", "user1");

      const queue = await getReviewQueue(orgId);
      const entry = queue.find((r) => r.slug === "behind-page");
      expect(entry).toBeDefined();
      expect(entry!.neverTrusted).toBe(false);
      expect(entry!.versionsBehind).toBe(2);
    });

    it("excludes pages whose trusted pointer already matches latest", async () => {
      await writePage(orgId, orgSlug, "synced-page", DEFAULT_YAML, "user1");
      const [v1Id] = await versionIdsDesc("synced-page");
      await markTrusted(orgId, "synced-page", v1Id, "reviewer1");

      const queue = await getReviewQueue(orgId);
      expect(queue.find((r) => r.slug === "synced-page")).toBeUndefined();
    });

    it("sorts oldest unapproved change first", async () => {
      await writePage(orgId, orgSlug, "older-unreviewed", DEFAULT_YAML, "user1");
      await new Promise((r) => setTimeout(r, 5));
      await writePage(orgId, orgSlug, "newer-unreviewed", DEFAULT_YAML, "user1");

      const queue = await getReviewQueue(orgId);
      const olderIdx = queue.findIndex((r) => r.slug === "older-unreviewed");
      const newerIdx = queue.findIndex((r) => r.slug === "newer-unreviewed");
      expect(olderIdx).toBeGreaterThanOrEqual(0);
      expect(newerIdx).toBeGreaterThanOrEqual(0);
      expect(olderIdx).toBeLessThan(newerIdx);
    });

    it("flags createdByMe and annotatedByMe for the requesting user", async () => {
      await writePage(orgId, orgSlug, "mine-page", DEFAULT_YAML, "me");
      await writePage(orgId, orgSlug, "annotated-page", DEFAULT_YAML, "someone-else");
      await saveAnnotation(orgId, orgSlug, "annotated-page", "note", "me");

      const queue = await getReviewQueue(orgId, "me");
      const mine = queue.find((r) => r.slug === "mine-page");
      const annotated = queue.find((r) => r.slug === "annotated-page");
      expect(mine!.createdByMe).toBe(true);
      expect(mine!.annotatedByMe).toBe(false);
      expect(annotated!.createdByMe).toBe(false);
      expect(annotated!.annotatedByMe).toBe(true);
    });

    it("getReviewQueueCount matches the queue length", async () => {
      await writePage(orgId, orgSlug, "count-page-a", DEFAULT_YAML, "user1");
      await writePage(orgId, orgSlug, "count-page-b", DEFAULT_YAML, "user1");

      const [queue, count] = await Promise.all([
        getReviewQueue(orgId),
        getReviewQueueCount(orgId),
      ]);
      expect(count).toBe(queue.length);
    });
  });
});
