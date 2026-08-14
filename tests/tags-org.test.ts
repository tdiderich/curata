import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { testDb } from "./setup";
import { createTestOrg, createTestPage } from "./helpers";

// Mock db to use test database
vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});

// resolveOrg is swapped per-test to simulate whichever user/role is "logged in".
const resolveOrgMock = vi.fn();
vi.mock("@/lib/auth", () => ({ resolveOrg: () => resolveOrgMock() }));

import { GET, POST, PATCH, DELETE } from "@/app/api/tags/org/route";

function req(method: string, url: string, body?: Record<string, unknown>): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

describe("/api/tags/org", () => {
  let orgId: string;
  let otherOrgId: string;

  beforeEach(async () => {
    const org = await createTestOrg({ name: "Tags Org", slug: "tags-org" });
    orgId = org.id;
    const otherOrg = await createTestOrg({ name: "Other Tags Org", slug: "other-tags-org" });
    otherOrgId = otherOrg.id;
  });

  function asAdmin() {
    resolveOrgMock.mockResolvedValue({ orgId, orgSlug: "tags-org", userId: "admin-1", role: "admin" });
  }
  function asMember() {
    resolveOrgMock.mockResolvedValue({ orgId, orgSlug: "tags-org", userId: "member-1", role: "member" });
  }

  describe("GET", () => {
    it("403s a member (owner/admin only)", async () => {
      asMember();
      const res = await GET();
      expect(res.status).toBe(403);
    });

    it("lists concepts used by this org's active pages with per-org page counts", async () => {
      asAdmin();
      const page1 = await createTestPage(orgId, { slug: "p1" });
      const page2 = await createTestPage(orgId, { slug: "p2" });
      const concept = await testDb.concept.create({
        data: { normalizedName: "engineering", displayName: "engineering", kind: "topic", usageCount: 2 },
      });
      await testDb.pageConcept.create({ data: { pageId: page1.id, conceptId: concept.id, createdBy: "agent" } });
      await testDb.pageConcept.create({ data: { pageId: page2.id, conceptId: concept.id, createdBy: "agent" } });

      const res = await GET();
      expect(res.status).toBe(200);
      const data = (await res.json()) as { concepts: Array<{ term: string; kind: string; pageCount: number }> };
      expect(data.concepts).toHaveLength(1);
      expect(data.concepts[0]).toMatchObject({ term: "engineering", kind: "topic", pageCount: 2 });
    });

    it("does not count another org's pages toward this org's page count", async () => {
      asAdmin();
      const myPage = await createTestPage(orgId, { slug: "mine" });
      const otherPage = await createTestPage(otherOrgId, { slug: "theirs" });
      const concept = await testDb.concept.create({
        data: { normalizedName: "shared-vendor", displayName: "shared-vendor", kind: "vendor", usageCount: 2 },
      });
      await testDb.pageConcept.create({ data: { pageId: myPage.id, conceptId: concept.id, createdBy: "agent" } });
      await testDb.pageConcept.create({ data: { pageId: otherPage.id, conceptId: concept.id, createdBy: "agent" } });

      const res = await GET();
      const data = (await res.json()) as { concepts: Array<{ pageCount: number }> };
      expect(data.concepts[0].pageCount).toBe(1);
    });

    it("excludes concepts this org doesn't use at all", async () => {
      asAdmin();
      await testDb.concept.create({
        data: { normalizedName: "unused-elsewhere", displayName: "unused-elsewhere", kind: "topic", usageCount: 0 },
      });
      const res = await GET();
      const data = (await res.json()) as { concepts: unknown[] };
      expect(data.concepts).toHaveLength(0);
    });
  });

  describe("POST (create)", () => {
    it("creates a standalone concept", async () => {
      asAdmin();
      const res = await POST(req("POST", "http://localhost/api/tags/org", { term: "New Concept", kind: "finding" }));
      expect(res.status).toBe(200);
      const data = (await res.json()) as { concept: { term: string; kind: string; pageCount: number } };
      expect(data.concept).toMatchObject({ term: "new-concept", kind: "finding", pageCount: 0 });
    });

    it("rejects a duplicate term", async () => {
      asAdmin();
      await testDb.concept.create({ data: { normalizedName: "dup", displayName: "dup", kind: "topic" } });
      const res = await POST(req("POST", "http://localhost/api/tags/org", { term: "dup" }));
      expect(res.status).toBe(409);
    });

    it("403s a member", async () => {
      asMember();
      const res = await POST(req("POST", "http://localhost/api/tags/org", { term: "x" }));
      expect(res.status).toBe(403);
    });
  });

  describe("PATCH (rename / re-kind)", () => {
    // Concept.normalizedName is globally unique and the `concepts`/`page_concepts`
    // tables aren't in setup.ts's per-test TRUNCATE list, so give each call its
    // own term to avoid colliding with rows other tests in this file created.
    let usedConceptCounter = 0;
    async function makeUsedConcept() {
      usedConceptCounter += 1;
      const term = `old-term-${usedConceptCounter}`;
      const page = await createTestPage(orgId, { slug: `used-page-${usedConceptCounter}` });
      const concept = await testDb.concept.create({
        data: { normalizedName: term, displayName: term, kind: "topic", usageCount: 1 },
      });
      await testDb.pageConcept.create({ data: { pageId: page.id, conceptId: concept.id, createdBy: "agent" } });
      return concept;
    }

    it("renames the term (updates normalizedName + displayName)", async () => {
      asAdmin();
      const concept = await makeUsedConcept();
      const res = await PATCH(req("PATCH", "http://localhost/api/tags/org", { conceptId: concept.id, term: "New Term" }));
      expect(res.status).toBe(200);
      const data = (await res.json()) as { concept: { term: string } };
      expect(data.concept.term).toBe("new-term");
      const updated = await testDb.concept.findUnique({ where: { id: concept.id } });
      expect(updated?.normalizedName).toBe("new-term");
    });

    it("changes the kind", async () => {
      asAdmin();
      const concept = await makeUsedConcept();
      const res = await PATCH(req("PATCH", "http://localhost/api/tags/org", { conceptId: concept.id, kind: "vendor" }));
      expect(res.status).toBe(200);
      const data = (await res.json()) as { concept: { kind: string } };
      expect(data.concept.kind).toBe("vendor");
    });

    it("409s renaming to a term that already exists", async () => {
      asAdmin();
      const concept = await makeUsedConcept();
      await testDb.concept.create({ data: { normalizedName: "taken", displayName: "taken", kind: "topic" } });
      const res = await PATCH(req("PATCH", "http://localhost/api/tags/org", { conceptId: concept.id, term: "taken" }));
      expect(res.status).toBe(409);
    });

    it("409s (not 500) when a concurrent writer takes the term between the pre-check and the update", async () => {
      asAdmin();
      const concept = await makeUsedConcept();
      // The colliding row already exists in the DB — simulating a second
      // request that renamed a different concept to this term in the window
      // between this request's collision check and its update. Bypass just
      // the collision-check findUnique (by normalizedName) so the pre-check
      // misses it and the real unique-constraint violation is what the
      // update's catch block has to handle.
      await testDb.concept.create({ data: { normalizedName: "raced-term", displayName: "raced-term", kind: "topic" } });
      const originalFindUnique = testDb.concept.findUnique.bind(testDb.concept);
      const spy = vi
        .spyOn(testDb.concept, "findUnique")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mockImplementation(async (args: any) => {
          if (args?.where?.normalizedName === "raced-term") return null;
          return originalFindUnique(args);
        });

      try {
        const res = await PATCH(req("PATCH", "http://localhost/api/tags/org", { conceptId: concept.id, term: "raced-term" }));
        expect(res.status).toBe(409);
      } finally {
        spy.mockRestore();
      }
    });

    it("404s a concept this org doesn't use", async () => {
      asAdmin();
      const concept = await testDb.concept.create({
        data: { normalizedName: "not-mine", displayName: "not-mine", kind: "topic" },
      });
      const res = await PATCH(req("PATCH", "http://localhost/api/tags/org", { conceptId: concept.id, term: "whatever" }));
      expect(res.status).toBe(404);
    });

    it("403s a member", async () => {
      asMember();
      const concept = await makeUsedConcept();
      const res = await PATCH(req("PATCH", "http://localhost/api/tags/org", { conceptId: concept.id, term: "x" }));
      expect(res.status).toBe(403);
    });
  });

  describe("DELETE (detach)", () => {
    it("detaches the concept from this org's pages without deleting the Concept row", async () => {
      asAdmin();
      const page = await createTestPage(orgId, { slug: "detach-page" });
      const concept = await testDb.concept.create({
        data: { normalizedName: "detach-me", displayName: "detach-me", kind: "topic", usageCount: 1 },
      });
      await testDb.pageConcept.create({ data: { pageId: page.id, conceptId: concept.id, createdBy: "agent" } });

      const res = await DELETE(req("DELETE", `http://localhost/api/tags/org?conceptId=${concept.id}`));
      expect(res.status).toBe(200);

      const remainingLink = await testDb.pageConcept.findFirst({ where: { conceptId: concept.id, pageId: page.id } });
      expect(remainingLink).toBeNull();
      const stillExists = await testDb.concept.findUnique({ where: { id: concept.id } });
      expect(stillExists).not.toBeNull();
      expect(stillExists?.usageCount).toBe(0);
    });

    it("leaves another org's usage of the same concept untouched", async () => {
      asAdmin();
      const myPage = await createTestPage(orgId, { slug: "mine-2" });
      const otherPage = await createTestPage(otherOrgId, { slug: "theirs-2" });
      const concept = await testDb.concept.create({
        data: { normalizedName: "cross-org", displayName: "cross-org", kind: "topic", usageCount: 2 },
      });
      await testDb.pageConcept.create({ data: { pageId: myPage.id, conceptId: concept.id, createdBy: "agent" } });
      await testDb.pageConcept.create({ data: { pageId: otherPage.id, conceptId: concept.id, createdBy: "agent" } });

      const res = await DELETE(req("DELETE", `http://localhost/api/tags/org?conceptId=${concept.id}`));
      expect(res.status).toBe(200);

      const otherLink = await testDb.pageConcept.findFirst({ where: { conceptId: concept.id, pageId: otherPage.id } });
      expect(otherLink).not.toBeNull();
      const stillExists = await testDb.concept.findUnique({ where: { id: concept.id } });
      expect(stillExists?.usageCount).toBe(1);
    });

    it("404s a concept not used by this org", async () => {
      asAdmin();
      const concept = await testDb.concept.create({
        data: { normalizedName: "orphan", displayName: "orphan", kind: "topic" },
      });
      const res = await DELETE(req("DELETE", `http://localhost/api/tags/org?conceptId=${concept.id}`));
      expect(res.status).toBe(404);
    });

    it("403s a member", async () => {
      asMember();
      const res = await DELETE(req("DELETE", "http://localhost/api/tags/org?conceptId=whatever"));
      expect(res.status).toBe(403);
    });
  });
});
