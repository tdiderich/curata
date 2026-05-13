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
  readPageYaml,
  writePage,
  searchPages,
  saveAnnotation,
  getAnnotations,
  updateAnnotationStatus,
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
});
