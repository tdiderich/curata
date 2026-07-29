import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestOrg, createTestPage } from "./helpers";

// Mock db module to use the test database instance
vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});

import { upsertConcepts, upsertLinks, getRelated, getPageLinks } from "@/lib/concepts";

describe("concepts", () => {
  let orgId: string;

  beforeEach(async () => {
    const org = await createTestOrg({ name: "Concepts Test Org", slug: "concepts-test-org" });
    orgId = org.id;
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
