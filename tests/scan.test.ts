import { describe, it, expect, vi } from "vitest";
import { createTestOrg, createTestPage } from "./helpers";

vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});
vi.mock("@/lib/kazam", () => ({
  validateYaml: async () => ({ valid: true, errors: [] }),
  hasSchemaFor: () => false,
  getBaseKazamSchema: () => null,
}));

import { testDb } from "./setup";
import { extractEmbeddedSlugs, extractExternalUrls, defaultAssetLabel, syncPageScan } from "@/lib/scan";
import { writePage } from "@/lib/pages";
import { getPageConcepts, sourceUpdatedAtByConcept, findConceptForTerm, normalizeTerm } from "@/lib/concepts";

describe("scan: pure extraction", () => {
  it("finds ref blocks and slugged sections at any depth, once each", () => {
    const doc = {
      components: [
        { type: "ref", slug: "pricing-table" },
        { type: "section", slug: "footer", components: [{ type: "ref", slug: "pricing-table" }] },
        { type: "tabs", tabs: [{ components: [{ type: "ref", slug: " legal-note " }] }] },
        { type: "section", title: "no slug here" },
      ],
    };
    expect(extractEmbeddedSlugs(doc).sort()).toEqual(["footer", "legal-note", "pricing-table"]);
  });

  it("finds URLs in prose, normalizes them, drops ignored hosts and trailing punctuation", () => {
    const doc = {
      components: [
        { type: "markdown", content: "See https://docs.google.com/document/d/abc/edit?usp=sharing and https://hubspot.com/pricing." },
        { type: "meta", fields: [{ key: "Deck", value: "https://docs.google.com/document/d/abc/view" }] },
        { type: "markdown", content: "chat at https://maze.slack.com/archives/C1 or https://internal.example.com/x" },
      ],
    };
    const urls = extractExternalUrls(doc, ["example.com"]);
    expect(urls.sort()).toEqual(["https://docs.google.com/document/d/abc", "https://hubspot.com/pricing"]);
  });

  it("labels an unnamed asset by host and last meaningful segment", () => {
    expect(defaultAssetLabel("https://docs.google.com/document/d/abc123")).toBe("docs.google.com · abc123");
    expect(defaultAssetLabel("https://hubspot.com")).toBe("hubspot.com");
  });
});

describe("scan: write path", () => {
  it("records embeds and external refs on write, replaces them on the next write, and reports what's new", async () => {
    const org = await createTestOrg({ name: "Scan Org", slug: "scan-org", ignoredDomains: ["ignored.test"] });
    await createTestPage(org.id, { slug: "pricing-table", title: "Pricing table" });
    const page = await createTestPage(org.id, { slug: "one-pager" });

    const first = await syncPageScan(org.id, page.id, {
      components: [
        { type: "ref", slug: "pricing-table" },
        { type: "markdown", content: "https://hubspot.com/pricing and https://ignored.test/nope" },
      ],
    }, "tester");
    expect(first.embeds).toEqual(["pricing-table"]);
    expect(first.externalUrls).toEqual(["https://hubspot.com/pricing"]);
    expect(first.newExternalUrls).toEqual(["https://hubspot.com/pricing"]);

    const concepts = await getPageConcepts(page.id);
    const embed = concepts.find((c) => c.term === "component/pricing-table");
    expect(embed?.rel).toBe("embeds");
    expect(await testDb.externalRef.count({ where: { pageId: page.id } })).toBe(1);

    // Source of a component/<slug> concept resolves to the component page even with no asserts tag.
    const concept = await findConceptForTerm("component/pricing-table", normalizeTerm("component/pricing-table"));
    const sources = await sourceUpdatedAtByConcept(org.id, [concept!.id]);
    expect(sources.get(concept!.id)).toBeInstanceOf(Date);

    // Second write drops the ref and swaps the URL: embeds edge gone, old ref gone, new one flagged as new.
    const second = await syncPageScan(org.id, page.id, {
      components: [{ type: "markdown", content: "moved to https://hubspot.com/pricing-v2" }],
    }, "tester");
    expect(second.embeds).toEqual([]);
    expect(second.newExternalUrls).toEqual(["https://hubspot.com/pricing-v2"]);
    expect((await getPageConcepts(page.id)).some((c) => c.rel === "embeds")).toBe(false);
    const refs = await testDb.externalRef.findMany({ where: { pageId: page.id }, select: { asset: { select: { url: true } } } });
    expect(refs.map((r) => r.asset.url)).toEqual(["https://hubspot.com/pricing-v2"]);
    // The old asset row survives (other pages may reference it); only this page's ref went.
    expect(await testDb.externalAsset.count({ where: { orgId: org.id } })).toBe(2);
  });

  it("runs from writePage without the caller asking", async () => {
    const org = await createTestOrg({ name: "Scan Org 2", slug: "scan-org-2" });
    const res = await writePage(org.id, org.slug, "auto-scan", `title: Auto\ncomponents:\n  - type: markdown\n    content: read https://github.com/tdiderich/kazam\n  - type: ref\n    slug: shared-footer\n`, "tester");
    expect(res.ok).toBe(true);
    const page = await testDb.page.findUnique({ where: { orgId_slug: { orgId: org.id, slug: "auto-scan" } } });
    expect((await getPageConcepts(page!.id)).find((c) => c.term === "component/shared-footer")?.rel).toBe("embeds");
    expect(await testDb.externalRef.count({ where: { pageId: page!.id } })).toBe(1);
  });
});
