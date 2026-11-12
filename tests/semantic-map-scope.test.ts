import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestOrg, createTestPage } from "./helpers";

vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});

// Visibility filtering only applies outside AUTH_MODE=none.
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  AUTH_MODE: "oauth",
}));

import { getDependents, getRelated, getSemanticMap, getVocabulary, upsertConcepts, upsertLinks } from "@/lib/concepts";
import { dispatch } from "@/lib/mcp-dispatch";

// Concepts and page links are global tables shared by every org. The graph
// tools must only ever show pages from the caller's org that the caller can
// see.
describe("concept graph scoping", () => {
  let orgA: string;
  let orgB: string;

  beforeEach(async () => {
    orgA = (await createTestOrg({ name: "Org A", slug: "scope-org-a" })).id;
    orgB = (await createTestOrg({ name: "Org B", slug: "scope-org-b" })).id;

    const aPage = await createTestPage(orgA, { slug: "a-page", title: "A Page", createdBy: "alice", visibility: "org" });
    await createTestPage(orgA, { slug: "a-target", title: "A Target", createdBy: "alice", visibility: "org" });
    const aPrivate = await createTestPage(orgA, { slug: "a-private", title: "A Private", createdBy: "bob", visibility: "private" });
    const bPage = await createTestPage(orgB, { slug: "b-secret", title: "B Secret Plan", createdBy: "mallory", visibility: "org" });
    await createTestPage(orgB, { slug: "b-target", title: "B Target", createdBy: "mallory", visibility: "org" });

    // "shared-term" is used in both orgs; each org also has its own term.
    await upsertConcepts(aPage.id, [{ term: "shared-term" }, { term: "a-only" }], "alice");
    await upsertConcepts(aPrivate.id, [{ term: "shared-term" }, { term: "bob-private-term" }], "bob");
    await upsertConcepts(bPage.id, [{ term: "shared-term" }, { term: "b-only", kind: "b-kind" }], "mallory");
    await upsertLinks(orgA, aPage.id, [{ target: "a-target", rel: "relates-to" }], "alice");
    await upsertLinks(orgA, aPrivate.id, [{ target: "a-target", rel: "relates-to" }], "bob");
    await upsertLinks(orgB, bPage.id, [{ target: "b-target", rel: "relates-to" }], "mallory");
  });

  it("getSemanticMap returns only the caller's org and visible pages", async () => {
    const map = await getSemanticMap(orgA, { userId: "alice" });
    const slugs = map.concepts.flatMap((c) => c.pages.map((p) => p.slug));
    const terms = map.concepts.map((c) => c.term);

    expect(slugs).toContain("a-page");
    expect(slugs).not.toContain("b-secret");
    expect(slugs).not.toContain("a-private");
    expect(terms).not.toContain("b-only");
    expect(terms).not.toContain("bob-private-term");
    expect(map.concepts.find((c) => c.term === "shared-term")?.usageCount).toBe(1);
    expect(map.links).toEqual([{ from: "a-page", to: "a-target", rel: "relates-to" }]);
    expect(map.stats.pagesWithConcepts + map.stats.pagesWithoutConcepts).toBe(2);
  });

  it("getSemanticMap shows a private page to its creator", async () => {
    const map = await getSemanticMap(orgA, { userId: "bob" });
    const slugs = map.concepts.flatMap((c) => c.pages.map((p) => p.slug));
    expect(slugs).toContain("a-private");
    expect(slugs).not.toContain("b-secret");
  });

  it("getVocabulary lists only terms on visible pages in the caller's org", async () => {
    const vocab = await getVocabulary(orgA, { userId: "alice" });
    const terms = vocab.concepts.map((c) => c.term);
    expect(terms).toEqual(expect.arrayContaining(["shared-term", "a-only"]));
    expect(terms).not.toContain("b-only");
    expect(terms).not.toContain("bob-private-term");
    expect(vocab.concepts.find((c) => c.term === "shared-term")?.usageCount).toBe(1);
    expect(vocab.kinds).not.toContain("b-kind");
  });

  it("MCP get_semantic_map and get_vocabulary are scoped the same way", async () => {
    const map = JSON.stringify(await dispatch("get_semantic_map", {}, orgA, "scope-org-a", "alice", "alice"));
    expect(map).toContain("a-page");
    expect(map).not.toMatch(/b-secret|B Secret Plan|a-private|b-only/);
    const vocab = JSON.stringify(await dispatch("get_vocabulary", {}, orgA, "scope-org-a", "alice", "alice"));
    expect(vocab).toContain("a-only");
    expect(vocab).not.toMatch(/b-only|bob-private-term/);
  });

  it("getRelated by term shows only visible pages in the caller's org", async () => {
    const r = await getRelated(orgA, { term: "shared-term", userId: "alice" });
    expect(r.pages.map((p) => p.slug)).toEqual(["a-page"]);
    expect(r.concepts[0].usageCount).toBe(1);
    // Another org's tag, or one only on someone else's private page, is unknown here.
    expect(await getRelated(orgA, { term: "b-only", userId: "alice" })).toEqual({ concepts: [], pages: [], links: [] });
    expect(await getRelated(orgA, { term: "bob-private-term", userId: "alice" })).toEqual({ concepts: [], pages: [], links: [] });
  });

  it("getRelated by slug treats a hidden page as missing and drops hidden neighbours", async () => {
    expect(await getRelated(orgA, { slug: "a-private", userId: "alice" })).toEqual({ concepts: [], pages: [], links: [] });
    const r = await getRelated(orgA, { slug: "a-target", userId: "alice" });
    expect(r.links).toEqual([{ from: "a-page", to: "a-target", rel: "relates-to" }]);
    const viaPage = await getRelated(orgA, { slug: "a-page", userId: "alice" });
    expect(viaPage.pages.map((p) => p.slug)).not.toContain("a-private");
    expect(viaPage.concepts.find((c) => c.term === "shared-term")?.usageCount).toBe(1);
  });

  it("getDependents hides other orgs' terms and private pages", async () => {
    await expect(getDependents(orgA, { term: "b-only", userId: "alice" })).rejects.toThrow(/concept not found/);
    await expect(getDependents(orgA, { term: "bob-private-term", userId: "alice" })).rejects.toThrow(/concept not found/);
    await expect(getDependents(orgA, { slug: "a-private", userId: "alice" })).rejects.toThrow(/page not found: a-private/);
    const r = await getDependents(orgA, { term: "shared-term", userId: "alice" });
    expect(r.concept?.usageCount).toBe(1);
    expect(JSON.stringify(r)).not.toMatch(/a-private|b-secret/);
    // The creator still sees their own page.
    await expect(getDependents(orgA, { slug: "a-private", userId: "bob" })).resolves.toBeTruthy();
  });
});
