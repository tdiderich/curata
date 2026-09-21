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
    expect(impact.text).toBe("2 pages and 1 external under impact/x are yellow now. Agents can clear the pages; someone owns each external.");
    expect((await getPageImpact(org.id, "i1")).text).toBeNull();
  });
});
