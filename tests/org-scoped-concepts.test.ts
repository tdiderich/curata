import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { testDb } from "./setup";
import { createTestOrg, createTestPage } from "./helpers";

vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});

const resolveOrgMock = vi.fn();
vi.mock("@/lib/auth", () => ({ AUTH_MODE: "none", resolveOrg: () => resolveOrgMock() }));

import { PATCH, PUT } from "@/app/api/tags/org/route";
import { upsertConcepts, getDependents, getVocabulary } from "@/lib/concepts";
import { getChartNode } from "@/lib/chart";
import { withOrgTags, extractOrgTags } from "@/lib/org-tags";

function req(method: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/tags/org", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("org-scoped concepts", () => {
  let orgA: string;
  let orgB: string;
  let pageA: { id: string };
  let pageB: { id: string };

  beforeEach(async () => {
    orgA = (await createTestOrg({ name: "A", slug: "scoped-a" })).id;
    orgB = (await createTestOrg({ name: "B", slug: "scoped-b" })).id;
    pageA = await createTestPage(orgA, { slug: "page-a" });
    pageB = await createTestPage(orgB, { slug: "page-b" });
    resolveOrgMock.mockResolvedValue({ orgId: orgA, orgSlug: "scoped-a", userId: "admin-a", role: "admin" });
  });

  const rowFor = (orgId: string, name: string) =>
    testDb.concept.findUnique({ where: { orgId_normalizedName: { orgId, normalizedName: name } } });

  it("two orgs tagging the same term get separate rows", async () => {
    await upsertConcepts(pageA.id, [{ term: "pricing", kind: "topic" }], "agent");
    await upsertConcepts(pageB.id, [{ term: "pricing", kind: "vendor" }], "agent");
    const a = await rowFor(orgA, "pricing");
    const b = await rowFor(orgB, "pricing");
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.id).not.toBe(b!.id);
    expect(a!.kind).toBe("topic");
    expect(b!.kind).toBe("vendor");
    expect(await testDb.concept.count({ where: { normalizedName: "pricing" } })).toBe(2);
  });

  it("usageCount is per org", async () => {
    const pageA2 = await createTestPage(orgA, { slug: "page-a2" });
    await upsertConcepts(pageA.id, [{ term: "pricing" }], "agent");
    await upsertConcepts(pageA2.id, [{ term: "pricing" }], "agent");
    await upsertConcepts(pageB.id, [{ term: "pricing" }], "agent");
    expect((await rowFor(orgA, "pricing"))!.usageCount).toBe(2);
    expect((await rowFor(orgB, "pricing"))!.usageCount).toBe(1);
    const vocabA = await getVocabulary(orgA, {});
    expect(vocabA.concepts.find((c) => c.term === "pricing")?.usageCount).toBe(2);
  });

  it("rename and re-kind in org A leave org B unchanged", async () => {
    await upsertConcepts(pageA.id, [{ term: "pricing", kind: "topic" }], "agent");
    await upsertConcepts(pageB.id, [{ term: "pricing", kind: "topic" }], "agent");
    const a = (await rowFor(orgA, "pricing"))!;
    const res = await PATCH(req("PATCH", { conceptId: a.id, term: "plans", kind: "vendor" }));
    expect(res.status).toBe(200);
    const b = await rowFor(orgB, "pricing");
    expect(b).not.toBeNull();
    expect(b!.displayName).toBe("pricing");
    expect(b!.kind).toBe("topic");
    expect(await rowFor(orgA, "plans")).not.toBeNull();
    expect(await rowFor(orgA, "pricing")).toBeNull();
  });

  it("org A cannot rename or merge org B's rows", async () => {
    await upsertConcepts(pageB.id, [{ term: "secret" }, { term: "other" }], "agent");
    const b = (await rowFor(orgB, "secret"))!;
    const b2 = (await rowFor(orgB, "other"))!;
    expect((await PATCH(req("PATCH", { conceptId: b.id, term: "x" }))).status).toBe(404);
    expect((await PUT(req("PUT", { sourceConceptId: b.id, targetConceptId: b2.id }))).status).toBe(404);
    expect(await rowFor(orgB, "secret")).not.toBeNull();
  });

  it("merge in org A doesn't touch org B", async () => {
    await upsertConcepts(pageA.id, [{ term: "old" }, { term: "new" }], "agent");
    await upsertConcepts(pageB.id, [{ term: "old" }, { term: "new" }], "agent");
    const src = (await rowFor(orgA, "old"))!;
    const tgt = (await rowFor(orgA, "new"))!;
    const res = await PUT(req("PUT", { sourceConceptId: src.id, targetConceptId: tgt.id }));
    expect(res.status).toBe(200);
    expect(await rowFor(orgA, "old")).toBeNull();
    const bOld = await rowFor(orgB, "old");
    expect(bOld).not.toBeNull();
    expect(await testDb.pageConcept.count({ where: { conceptId: bOld!.id, pageId: pageB.id } })).toBe(1);
    expect((await rowFor(orgB, "new"))!.usageCount).toBe(1);
  });

  it("recommending in org A doesn't affect org B", async () => {
    await upsertConcepts(pageB.id, [{ term: "pricing" }], "agent");
    await withOrgTags(orgB, ["pricing"]);
    await withOrgTags(orgA, ["pricing"]);
    expect(await extractOrgTags(orgA)).toEqual(["pricing"]);
    expect(await extractOrgTags(orgB)).toEqual(["pricing"]);
    await withOrgTags(orgA, []);
    expect(await extractOrgTags(orgA)).toEqual([]);
    expect(await extractOrgTags(orgB)).toEqual(["pricing"]);
    expect((await rowFor(orgB, "pricing"))!.isRecommended).toBe(true);
  });

  it("a term only org B uses is 'concept not found' in org A", async () => {
    await upsertConcepts(pageB.id, [{ term: "only-b", rel: "asserts" }], "agent");
    await expect(getChartNode(orgA, "only-b", null)).rejects.toThrow(/concept not found: only-b/);
    await expect(getDependents(orgA, { term: "only-b" })).rejects.toThrow(/concept not found: only-b/);
    // Still resolves in B.
    await expect(getDependents(orgB, { term: "only-b" })).resolves.toBeTruthy();
  });
});
