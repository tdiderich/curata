import { describe, it, expect, beforeEach, vi } from "vitest";
import { testDb } from "./setup";
import { createTestOrg, createTestPage } from "./helpers";

// Mock db to use test database
vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});

import { buildKnowledgeGraph } from "@/lib/graph";
import { DEFAULT_TAGS } from "@/lib/default-tags";

async function tagPage(pageId: string, name: string, createdBy = "user-a") {
  const concept = await testDb.concept.upsert({
    where: { normalizedName: name },
    update: {},
    create: { normalizedName: name, displayName: name, kind: "topic" },
  });
  await testDb.pageConcept.create({ data: { pageId, conceptId: concept.id, createdBy } });
  return concept;
}

describe("buildKnowledgeGraph", () => {
  let orgId: string;

  beforeEach(async () => {
    const org = await createTestOrg({ name: "Graph Org", slug: "graph-org" });
    orgId = org.id;
  });

  it("classifies tag tiers: default list, multi-creator org, single-creator personal", async () => {
    const a = await createTestPage(orgId, { slug: "a", title: "A" });
    const b = await createTestPage(orgId, { slug: "b", title: "B" });
    await tagPage(a.id, "faq", "user-a"); // in DEFAULT_TAGS
    await tagPage(a.id, "kubernetes", "user-a");
    await tagPage(b.id, "kubernetes", "user-b"); // two creators -> org
    await tagPage(b.id, "my-notes", "user-b"); // one creator -> personal

    const g = await buildKnowledgeGraph(orgId);
    const byName = Object.fromEntries(g.tags.map((t) => [t.name, t.tier]));
    expect(byName["faq"]).toBe("default");
    expect(byName["kubernetes"]).toBe("org");
    expect(byName["my-notes"]).toBe("personal");
  });

  it("returns edges linking tags to pages and positive token weights", async () => {
    const a = await createTestPage(orgId, { slug: "a", title: "A" });
    const concept = await tagPage(a.id, "faq");

    const g = await buildKnowledgeGraph(orgId);
    expect(g.edges).toContainEqual({ tagId: concept.id, pageId: a.id });
    expect(g.tags[0].tokens).toBeGreaterThan(0);
    expect(g.pages.map((p) => p.slug)).toContain("a");
  });

  it("lists untagged active pages as the queue and excludes them from the graph", async () => {
    const tagged = await createTestPage(orgId, { slug: "tagged", title: "Tagged" });
    await tagPage(tagged.id, "faq");
    await createTestPage(orgId, { slug: "loose", title: "Loose Page" });
    await createTestPage(orgId, { slug: "gone", title: "Archived", status: "archived" });

    const g = await buildKnowledgeGraph(orgId);
    expect(g.untagged.map((p) => p.slug)).toEqual(["loose"]);
    expect(g.pages.map((p) => p.slug)).not.toContain("loose");
  });

  it("suggests unused default tags and drops used ones", async () => {
    const a = await createTestPage(orgId, { slug: "a", title: "A" });
    await tagPage(a.id, "faq");

    const g = await buildKnowledgeGraph(orgId);
    expect(g.suggestedTags).not.toContain("faq");
    expect(g.suggestedTags).toContain("engineering");
    expect(g.suggestedTags.length).toBe(DEFAULT_TAGS.length - 1);
  });

  it("does not leak another org's pages or tags", async () => {
    const other = await createTestOrg({ name: "Other", slug: "other-graph-org" });
    const foreign = await createTestPage(other.id, { slug: "foreign", title: "Foreign" });
    await tagPage(foreign.id, "faq");

    const g = await buildKnowledgeGraph(orgId);
    expect(g.tags).toHaveLength(0);
    expect(g.pages).toHaveLength(0);
    expect(g.untagged).toHaveLength(0);
  });
});
