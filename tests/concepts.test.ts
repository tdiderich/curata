import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestOrg, createTestPage } from "./helpers";

// Mock db module to use the test database instance
vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});

import {
  upsertConcepts,
  upsertLinks,
  getRelated,
  getPageLinks,
  getPageConcepts,
  getVocabulary,
  normalizeTerm,
} from "@/lib/concepts";
import { CONCEPT_KINDS } from "@/lib/concept-kinds";

describe("concepts", () => {
  let orgId: string;

  beforeEach(async () => {
    const org = await createTestOrg({ name: "Concepts Test Org", slug: "concepts-test-org" });
    orgId = org.id;
  });

  describe("normalizeTerm", () => {
    it("slugs terms to lowercase letters, digits, and hyphens", () => {
      expect(normalizeTerm("Noise Reduction")).toBe("noise-reduction");
      expect(normalizeTerm("  yada   yada  ")).toBe("yada-yada");
      expect(normalizeTerm("SOC2!")).toBe("soc2");
      expect(normalizeTerm("already-good")).toBe("already-good");
      expect(normalizeTerm("under_score")).toBe("under-score");
      expect(normalizeTerm("--edge--case--")).toBe("edge-case");
      expect(normalizeTerm("???")).toBe("");
    });
  });

  describe("upsertConcepts", () => {
    it("merges spaced and hyphenated spellings into one concept", async () => {
      const page = await createTestPage(orgId, { slug: "spelling-page" });
      await upsertConcepts(page.id, [{ term: "Noise Reduction" }], "agent");
      await upsertConcepts(page.id, [{ term: "noise-reduction" }], "agent");

      const concepts = await getPageConcepts(page.id);
      expect(concepts).toHaveLength(1);
      expect(concepts[0].term).toBe("noise-reduction");
    });

    it("re-kinds an existing concept when a kind is supplied", async () => {
      const page = await createTestPage(orgId, { slug: "rekind-page" });
      await upsertConcepts(page.id, [{ term: "jira" }], "agent");
      expect((await getPageConcepts(page.id))[0].kind).toBe("");

      await upsertConcepts(page.id, [{ term: "jira", kind: "vendor" }], "agent");
      expect((await getPageConcepts(page.id))[0].kind).toBe("vendor");
    });

    it("keeps the existing kind when none is supplied", async () => {
      const page = await createTestPage(orgId, { slug: "keep-kind-page" });
      await upsertConcepts(page.id, [{ term: "jira", kind: "vendor" }], "agent");
      await upsertConcepts(page.id, [{ term: "jira" }], "agent");
      expect((await getPageConcepts(page.id))[0].kind).toBe("vendor");
    });

    it("remove detaches from the page without deleting the concept", async () => {
      const pageA = await createTestPage(orgId, { slug: "remove-a" });
      const pageB = await createTestPage(orgId, { slug: "remove-b" });
      await upsertConcepts(pageA.id, [{ term: "stale-tag", kind: "topic" }], "agent");
      await upsertConcepts(pageB.id, [{ term: "stale-tag" }], "agent");

      await upsertConcepts(pageA.id, [{ term: "stale-tag", remove: true }], "agent");

      expect(await getPageConcepts(pageA.id)).toHaveLength(0);
      const bConcepts = await getPageConcepts(pageB.id);
      expect(bConcepts).toHaveLength(1);
      expect(bConcepts[0].kind).toBe("topic");
    });

    it("remove of an unknown term is a no-op", async () => {
      const page = await createTestPage(orgId, { slug: "remove-unknown" });
      await upsertConcepts(page.id, [{ term: "never-existed", remove: true }], "agent");
      expect(await getPageConcepts(page.id)).toHaveLength(0);
    });
  });

  describe("getVocabulary", () => {
    it("lists curated kinds first, then in-use extras", async () => {
      const page = await createTestPage(orgId, { slug: "vocab-page" });
      await upsertConcepts(page.id, [{ term: "acme", kind: "custom-kind" }], "agent");

      const vocab = await getVocabulary();
      expect(vocab.kinds.slice(0, CONCEPT_KINDS.length)).toEqual([...CONCEPT_KINDS]);
      expect(vocab.kinds).toContain("custom-kind");
    });
  });

  describe("upsertLinks", () => {
    it("prunes edges the page no longer declares", async () => {
      const from = await createTestPage(orgId, { slug: "from-page" });
      await createTestPage(orgId, { slug: "target-a" });
      await createTestPage(orgId, { slug: "target-b" });

      await upsertLinks(orgId, from.id, [
        { target: "target-a", rel: "relates-to" },
        { target: "target-b", rel: "relates-to" },
      ], "agent");
      expect(await getPageLinks(orgId, from.id)).toHaveLength(2);

      // target-b dropped from the declared set
      await upsertLinks(orgId, from.id, [{ target: "target-a", rel: "relates-to" }], "agent");
      const remaining = await getPageLinks(orgId, from.id);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].target).toBe("target-a");
    });

    it("prunes an edge whose rel changed", async () => {
      const from = await createTestPage(orgId, { slug: "from-page" });
      await createTestPage(orgId, { slug: "target-a" });

      await upsertLinks(orgId, from.id, [{ target: "target-a", rel: "supersedes" }], "agent");
      await upsertLinks(orgId, from.id, [{ target: "target-a", rel: "relates-to" }], "agent");

      const remaining = await getPageLinks(orgId, from.id);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].rel).toBe("relates-to");
    });

    it("clears every edge when passed an empty set", async () => {
      const from = await createTestPage(orgId, { slug: "from-page" });
      await createTestPage(orgId, { slug: "target-a" });

      await upsertLinks(orgId, from.id, [{ target: "target-a", rel: "relates-to" }], "agent");
      await upsertLinks(orgId, from.id, [], "agent");

      expect(await getPageLinks(orgId, from.id)).toHaveLength(0);
    });

    it("leaves edges from other pages alone", async () => {
      const from = await createTestPage(orgId, { slug: "from-page" });
      const other = await createTestPage(orgId, { slug: "other-page" });
      await createTestPage(orgId, { slug: "target-a" });

      await upsertLinks(orgId, other.id, [{ target: "target-a", rel: "relates-to" }], "agent");
      await upsertLinks(orgId, from.id, [], "agent");

      expect(await getPageLinks(orgId, other.id)).toHaveLength(1);
    });
  });

  describe("getRelated", () => {
    it("omits archived pages from the term lookup", async () => {
      const active = await createTestPage(orgId, { slug: "active-page" });
      const archived = await createTestPage(orgId, { slug: "archived-page", status: "archived" });
      await upsertConcepts(active.id, [{ term: "Shared Term" }], "agent");
      await upsertConcepts(archived.id, [{ term: "Shared Term" }], "agent");

      const result = await getRelated(orgId, { term: "shared term" });
      expect(result.pages.map((p) => p.slug)).toEqual(["active-page"]);
    });

    it("scopes the term lookup to the caller's org", async () => {
      const otherOrg = await createTestOrg({ name: "Other Org", slug: "other-org" });
      const mine = await createTestPage(orgId, { slug: "my-page" });
      const theirs = await createTestPage(otherOrg.id, { slug: "their-page" });
      await upsertConcepts(mine.id, [{ term: "Shared Term" }], "agent");
      await upsertConcepts(theirs.id, [{ term: "Shared Term" }], "agent");

      const result = await getRelated(orgId, { term: "shared term" });
      expect(result.pages.map((p) => p.slug)).toEqual(["my-page"]);
    });

    it("omits archived pages from the slug lookup", async () => {
      const subject = await createTestPage(orgId, { slug: "subject-page" });
      const active = await createTestPage(orgId, { slug: "active-page" });
      const archived = await createTestPage(orgId, { slug: "archived-page", status: "archived" });
      for (const p of [subject, active, archived]) {
        await upsertConcepts(p.id, [{ term: "Shared Term" }], "agent");
      }

      const result = await getRelated(orgId, { slug: "subject-page" });
      expect(result.pages.map((p) => p.slug)).toEqual(["active-page"]);
    });

    it("omits links pointing at archived pages", async () => {
      const subject = await createTestPage(orgId, { slug: "subject-page" });
      await createTestPage(orgId, { slug: "active-page" });
      await createTestPage(orgId, { slug: "archived-page", status: "archived" });

      await upsertLinks(orgId, subject.id, [
        { target: "active-page", rel: "relates-to" },
        { target: "archived-page", rel: "relates-to" },
      ], "agent");

      const result = await getRelated(orgId, { slug: "subject-page" });
      expect(result.links.map((l) => l.to)).toEqual(["active-page"]);
    });
  });
});
