import { describe, it, expect, vi } from "vitest";
import { createTestOrg, createTestPage } from "./helpers";

vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});

import { testDb } from "./setup";
import { getChart, getChartNode, getNeedsLook, setChartNode, NODE_FANOUT_THRESHOLD } from "@/lib/chart";
import { upsertConcepts, upsertExternalDependents, verifyDependent } from "@/lib/concepts";

async function bumpSource(pageId: string, times = 1) {
  for (let i = 0; i < times; i++) {
    await new Promise((r) => setTimeout(r, 5));
    await testDb.pageVersion.create({ data: { pageId, yamlContent: `title: v${i}\ncomponents: []\n`, contentHash: `h${Date.now()}${i}`, createdBy: "tester" } });
    await testDb.page.update({ where: { id: pageId }, data: { updatedAt: new Date() } });
  }
}

describe("chart", () => {
  it("ranks nodes by fan-out, hides small ones unless promoted, colors children from source drift", async () => {
    const org = await createTestOrg({ name: "Chart Org", slug: "chart-org" });
    const pricing = await createTestPage(org.id, { slug: "pricing", title: "Pricing" });
    await upsertConcepts(pricing.id, [{ term: "chart/pricing", rel: "asserts" }], "tester");
    const deps = [];
    for (const slug of ["battle-card", "talk-track", "onboarding"]) {
      const p = await createTestPage(org.id, { slug, title: slug });
      await upsertConcepts(p.id, [{ term: "chart/pricing", rel: "depends" }], "tester");
      deps.push(p);
    }
    await upsertExternalDependents(org.id, "chart/pricing", [{ url: "https://hubspot.com/pricing", label: "HubSpot pricing" }], "tester");

    // A concept with one dependent is a leaf, not a node.
    const small = await createTestPage(org.id, { slug: "small-dep" });
    await upsertConcepts(small.id, [{ term: "chart/small", rel: "depends" }], "tester");

    let chart = await getChart(org.id);
    expect(chart.nodes.map((n) => n.term)).toEqual(["chart/pricing"]);
    const node = chart.nodes[0];
    expect(node.fanOut).toBe(4);
    expect(node.source?.slug).toBe("pricing");
    // Fresh page edges are verified on tag; the external was attached, not checked, so it's yellow.
    // A never-checked edge only counts source moves after it was added, so it is yellow, never born red.
    expect(node.counts).toEqual({ green: 3, yellow: 1, red: 0 });
    expect(node.color).toBe("yellow");

    // Source moves once: every page child goes yellow.
    await bumpSource(pricing.id, 1);
    let detail = await getChartNode(org.id, "chart/pricing");
    expect(detail.children.filter((c) => c.kind === "page").every((c) => c.color === "yellow")).toBe(true);
    expect(detail.children.find((c) => c.slug === "battle-card")?.reason).toBe("not checked since the change");

    // Checking one page under this node turns it green; the rest stay yellow.
    await verifyDependent(org.id, { slug: "battle-card", term: "chart/pricing" });
    detail = await getChartNode(org.id, "chart/pricing");
    expect(detail.children.find((c) => c.slug === "battle-card")?.color).toBe("green");
    expect(detail.children.find((c) => c.slug === "talk-track")?.color).toBe("yellow");

    // Source moves again with no check: talk-track has now seen two moves, red.
    await bumpSource(pricing.id, 1);
    detail = await getChartNode(org.id, "chart/pricing");
    expect(detail.children.find((c) => c.slug === "talk-track")?.color).toBe("red");
    expect(detail.children.find((c) => c.slug === "talk-track")?.reason).toMatch(/moved 2 times/);
    // battle-card was checked between the two moves, so only one move since: yellow.
    expect(detail.children.find((c) => c.slug === "battle-card")?.color).toBe("yellow");

    // Past due external goes red.
    await testDb.externalEdge.updateMany({ where: { asset: { url: "https://hubspot.com/pricing" } }, data: { dueAt: new Date(Date.now() - 86400000) } });
    detail = await getChartNode(org.id, "chart/pricing");
    const ext = detail.children.find((c) => c.kind === "external")!;
    expect(ext.color).toBe("red");
    expect(ext.reason).toBe("past due");
    expect(detail.color).toBe("red");

    // needs_change outranks "nobody looked": mismatch is red even with no due date and one move.
    await verifyDependent(org.id, { slug: "battle-card", term: "chart/pricing", status: "needs_change", note: "still says $12" });
    detail = await getChartNode(org.id, "chart/pricing");
    expect(detail.children.find((c) => c.slug === "battle-card")?.color).toBe("red");
    expect(detail.children.find((c) => c.slug === "battle-card")?.reason).toBe("mismatch: still says $12");

    // Needs-look list is the same rows, greens dropped, grouped by node.
    const list = await getNeedsLook(org.id);
    expect(list).toHaveLength(1);
    expect(list[0].children.every((c) => c.color !== "green")).toBe(true);
    expect(list[0].children.length).toBe(4);

    // Promote the small one and it appears; hide pricing and it goes.
    await setChartNode(org.id, "chart/small", { promoted: true });
    await setChartNode(org.id, "chart/pricing", { hidden: true });
    chart = await getChart(org.id);
    expect(chart.nodes.map((n) => n.term)).toEqual(["chart/small"]);
    expect((await getChart(org.id, { includeHidden: true })).nodes.map((n) => n.term).sort()).toEqual(["chart/pricing", "chart/small"]);
    expect(NODE_FANOUT_THRESHOLD).toBe(3);
  });

  it("template and component nodes get a source from the page with that slug, and shared children report alsoUnder", async () => {
    const org = await createTestOrg({ name: "Chart Org 2", slug: "chart-org-2" });
    const tmpl = await createTestPage(org.id, { slug: "one-pager", title: "One-pager template" });
    const comp = await createTestPage(org.id, { slug: "pricing-table", title: "Pricing table" });
    for (const slug of ["acme", "globex", "initech"]) {
      const p = await createTestPage(org.id, { slug: `one-pager-${slug}` });
      await upsertConcepts(p.id, [{ term: "template/one-pager", kind: "template", rel: "instantiates" }, { term: "component/pricing-table", kind: "component", rel: "embeds" }], "tester");
    }
    const chart = await getChart(org.id);
    const terms = chart.nodes.map((n) => n.term).sort();
    expect(terms).toEqual(["component/pricing-table", "template/one-pager"]);
    const t = chart.nodes.find((n) => n.term === "template/one-pager")!;
    expect(t.source?.slug).toBe("one-pager");
    expect(t.title).toBe("One-pager template");
    expect(t.kind).toBe("template");

    const detail = await getChartNode(org.id, "component/pricing-table");
    expect(detail.source?.slug).toBe("pricing-table");
    expect(detail.children[0].alsoUnder).toEqual(["template/one-pager"]);

    // Component page changes: every embedding page goes yellow.
    await bumpSource(comp.id, 1);
    const after = await getChartNode(org.id, "component/pricing-table");
    expect(after.counts.yellow).toBe(3);
    expect(tmpl.id).toBeTruthy();
  });
});

describe("page impact", () => {
  it("counts what sits under the nodes a page is the source of, and reads as one line", async () => {
    const { getPageImpact } = await import("@/lib/chart");
    const org = await createTestOrg({ name: "Impact Org", slug: "impact-org" });
    const src = await createTestPage(org.id, { slug: "impact-src" });
    await upsertConcepts(src.id, [{ term: "impact/x", rel: "asserts" }], "tester");
    for (const s of ["i1", "i2"]) {
      const p = await createTestPage(org.id, { slug: s });
      await upsertConcepts(p.id, [{ term: "impact/x", rel: "depends" }], "tester");
    }
    await upsertExternalDependents(org.id, "impact/x", [{ url: "https://hubspot.com/x" }], "tester");
    const impact = await getPageImpact(org.id, "impact-src");
    expect(impact.nodes).toEqual([{ term: "impact/x", pages: 2, external: 1 }]);
    expect(impact.text).toBe("2 pages and 1 external under impact/x need a look now. Agents can clear the pages; someone owns each external.");
    expect((await getPageImpact(org.id, "i1")).text).toBeNull();
  });
});

describe("promote a page to a node", () => {
  it("asserts a concept named after the slug and shows the node before anything sits under it", async () => {
    const { promotePageToNode } = await import("@/lib/chart");
    const org = await createTestOrg({ name: "Promote Org", slug: "promote-org" });
    await createTestPage(org.id, { slug: "security-faq", title: "Security FAQ" });
    const node = await promotePageToNode(org.id, "security-faq", "tester");
    expect(node.term).toBe("security-faq");
    expect(node.promoted).toBe(true);
    expect(node.source?.slug).toBe("security-faq");
    expect((await getChart(org.id)).nodes.map((n) => n.term)).toEqual(["security-faq"]);
    await expect(promotePageToNode(org.id, "nope", "tester")).rejects.toThrow(/page not found/);
  });
});

describe("createNode: the New top level content form", () => {
  it("creates the source page when none is picked, promotes it, and puts related content under it", async () => {
    const { createNode } = await import("@/lib/chart");
    const org = await createTestOrg({ name: "Create Org", slug: "create-org" });
    const dep = await createTestPage(org.id, { slug: "renewal-email", title: "Renewal email" });
    const node = await createNode(org.id, org.slug, {
      title: "Renewal pricing",
      related: [{ slug: "renewal-email" }, { url: "https://app.hubspot.com/quotes/1", label: "Quote template" }],
    }, "tester");
    expect(node.term).toBe("renewal-pricing");
    expect(node.source?.slug).toBe("renewal-pricing");
    expect(node.promoted).toBe(true);
    expect(node.children.map((c) => c.slug ?? c.url).sort()).toEqual(["https://app.hubspot.com/quotes/1", "renewal-email"]);
    expect(await testDb.page.count({ where: { orgId: org.id, slug: "renewal-pricing" } })).toBe(1);
    await expect(createNode(org.id, org.slug, { title: "Renewal pricing" }, "tester")).rejects.toThrow(/already exists/);
    // Existing page as the source: nothing new is created.
    const n2 = await createNode(org.id, org.slug, { title: "Renewal email", slug: "renewal-email" }, "tester");
    expect(n2.source?.slug).toBe("renewal-email");
    expect(dep.id).toBeTruthy();
  });
});

describe("cold agent pass 2 fixes", () => {
  it("set_chart_node with term and slug re-points the source; add_to_chart refuses an unknown term; a revert is one move", async () => {
    const { setChartNode } = await import("@/lib/chart");
    const { addScopeItem } = await import("@/lib/scope");
    const org = await createTestOrg({ name: "Cold2 Org", slug: "cold2-org" });
    const oldSrc = await createTestPage(org.id, { slug: "old-src", title: "Old" });
    const newSrc = await createTestPage(org.id, { slug: "new-src", title: "New source" });
    await upsertConcepts(oldSrc.id, [{ term: "cold2/x", rel: "asserts" }], "tester");
    for (const s of ["c1", "c2", "c3"]) {
      const p = await createTestPage(org.id, { slug: s });
      await upsertConcepts(p.id, [{ term: "cold2/x", rel: "depends" }], "tester");
    }
    const node = await setChartNode(org.id, "cold2/x", { sourceSlug: "new-src" });
    expect(node.source?.slug).toBe("new-src");
    expect(node.title).toBe("New source");
    expect(await testDb.pageConcept.count({ where: { pageId: oldSrc.id, rel: "asserts" } })).toBe(0);

    await expect(addScopeItem(org.id, "cold2/nope", { slug: "c1" }, "tester")).rejects.toThrow(/concept not found: cold2\/nope/);

    // Edit then revert the source: content is back where it was at the last check, so children stay green.
    const before = await getChartNode(org.id, "cold2/x");
    expect(before.children.every((c) => c.color === "green")).toBe(true);
    const v0 = await testDb.pageVersion.findFirst({ where: { pageId: newSrc.id }, orderBy: { createdAt: "asc" } });
    await bumpSource(newSrc.id, 1);
    const mid = await getChartNode(org.id, "cold2/x");
    expect(mid.children.filter((c) => c.slug).every((c) => c.color === "yellow")).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    await testDb.pageVersion.create({ data: { pageId: newSrc.id, yamlContent: v0!.yamlContent, contentHash: v0!.contentHash, createdBy: "tester" } });
    await testDb.page.update({ where: { id: newSrc.id }, data: { updatedAt: new Date() } });
    const after = await getChartNode(org.id, "cold2/x");
    expect(after.children.filter((c) => c.slug).every((c) => c.color === "green")).toBe(true);
  });
});

describe("verify outcomes on the chart", () => {
  it("a write reads as edited, unreachable stays yellow with the reason and never escalates on moves", async () => {
    const org = await createTestOrg({ name: "Verify Org", slug: "verify-org" });
    const src = await createTestPage(org.id, { slug: "v-src" });
    await upsertConcepts(src.id, [{ term: "verify/x", rel: "asserts" }], "tester");
    const dep = await createTestPage(org.id, { slug: "v-dep" });
    await upsertConcepts(dep.id, [{ term: "verify/x", rel: "depends" }], "tester");
    await upsertExternalDependents(org.id, "verify/x", [{ url: "https://docs.google.com/document/d/v1" }], "tester");
    const { verifyAllEdgesForPage } = await import("@/lib/concepts");

    await bumpSource(src.id, 1);
    await verifyAllEdgesForPage(dep.id);
    let node = await getChartNode(org.id, "verify/x");
    const page = node.children.find((c) => c.slug === "v-dep")!;
    expect(page.color).toBe("green");
    expect(page.note).toBe("edited");

    await verifyDependent(org.id, { url: "https://docs.google.com/document/d/v1", term: "verify/x", status: "unreachable", note: "no google-drive MCP this session" });
    node = await getChartNode(org.id, "verify/x");
    let ext = node.children.find((c) => c.kind === "external")!;
    expect(ext.color).toBe("yellow");
    expect(ext.reason).toBe("couldn't check · no google-drive MCP this session");
    expect(ext.lastCheckedAt).toBeNull();

    // Two more source moves would make an unchecked row red; an unreachable one stays yellow.
    await bumpSource(src.id, 2);
    node = await getChartNode(org.id, "verify/x");
    ext = node.children.find((c) => c.kind === "external")!;
    expect(ext.color).toBe("yellow");
    expect(node.children.find((c) => c.slug === "v-dep")?.color).toBe("red");

    // A real check clears it.
    await verifyDependent(org.id, { url: "https://docs.google.com/document/d/v1", term: "verify/x" });
    node = await getChartNode(org.id, "verify/x");
    expect(node.children.find((c) => c.kind === "external")?.color).toBe("green");
  });
});

describe("per-node instructions", () => {
  it("stores, returns on the node, trims, and clears on empty string", async () => {
    const { createTestOrg, createTestPage } = await import("./helpers");
    const { upsertConcepts } = await import("@/lib/concepts");
    const org = await createTestOrg({ name: "Instr Org", slug: "instr-org" });
    const src = await createTestPage(org.id, { slug: "instr-src" });
    await upsertConcepts(src.id, [{ term: "instr/launch", rel: "asserts" }], "system");
    let node = await setChartNode(org.id, "instr/launch", { promoted: true, instructions: "  Decide if this matters to the customer. Add an agenda item.  " });
    expect(node.instructions).toBe("Decide if this matters to the customer. Add an agenda item.");
    expect((await getChartNode(org.id, "instr/launch")).instructions).toBe("Decide if this matters to the customer. Add an agenda item.");
    node = await setChartNode(org.id, "instr/launch", { instructions: "" });
    expect(node.instructions).toBeNull();
    expect(node.promoted).toBe(true);
  });
});
