import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestOrg, createTestPage } from "./helpers";

vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});

// create_from_template runs the kazam validators; stub them so this suite
// doesn't shell out to the real binary.
const validateContentMock = vi.fn().mockResolvedValue([]);
vi.mock("@/lib/kazam", async () => {
  const actual = await vi.importActual<typeof import("@/lib/kazam")>("@/lib/kazam");
  return {
    ...actual,
    validateContent: (...args: unknown[]) => validateContentMock(...args),
    validateContentSplit: async (...args: unknown[]) => ({ errors: await validateContentMock(...args), warnings: [] }),
    checkUnsupportedComponents: vi.fn().mockReturnValue([]),
  };
});

import {
  normalizeTerm,
  upsertConcepts,
  upsertLinks,
  getPageConcepts,
  getPageLinks,
  getDependents,
  templateConceptTerm,
  normalizeExternalUrl,
  upsertExternalDependents,
  verifyDependent,
  mapDependencies,
  listConceptMaps,
  includeMap,
} from "@/lib/concepts";
import { dispatch, describeToolParams } from "@/lib/mcp-dispatch";
import { testDb } from "./setup";

// Concept rows are global and never truncated between tests, so every test
// here uses terms unique to this file.
const T = (s: string) => `dep-${s}`;

describe("normalizeTerm namespaces", () => {
  it("keeps one interior slash", () => {
    expect(normalizeTerm("Template/POV ROI")).toBe("template/pov-roi");
    expect(normalizeTerm("feature/gcp support")).toBe("feature/gcp-support");
    expect(normalizeTerm("a/b/c")).toBe("a/b-c");
    expect(normalizeTerm("/x/")).toBe("x");
    expect(normalizeTerm("only/")).toBe("only");
    expect(normalizeTerm("/only")).toBe("only");
  });

  it("still slugs plain terms exactly as before", () => {
    expect(normalizeTerm("Noise Reduction")).toBe("noise-reduction");
    expect(normalizeTerm("--edge--case--")).toBe("edge-case");
    expect(normalizeTerm("???")).toBe("");
  });
});

describe("rel on concept edges", () => {
  let orgId: string;

  beforeEach(async () => {
    const org = await createTestOrg({ name: "Dep Org", slug: "dep-org" });
    orgId = org.id;
  });

  it("defaults to references and can be set on write", async () => {
    const page = await createTestPage(orgId, { slug: "rel-default" });
    await upsertConcepts(page.id, [{ term: T("plain") }, { term: T("owned"), rel: "asserts" }], "agent");
    const byTerm = Object.fromEntries((await getPageConcepts(page.id)).map((c) => [c.term, c.rel]));
    expect(byTerm[T("plain")]).toBe("references");
    expect(byTerm[T("owned")]).toBe("asserts");
  });

  it("re-tagging with a rel updates it, re-tagging without one leaves it", async () => {
    const page = await createTestPage(orgId, { slug: "rel-update" });
    await upsertConcepts(page.id, [{ term: T("flip"), rel: "references" }], "agent");
    await upsertConcepts(page.id, [{ term: T("flip"), rel: "depends" }], "agent");
    expect((await getPageConcepts(page.id))[0].rel).toBe("depends");
    await upsertConcepts(page.id, [{ term: T("flip"), kind: "vendor" }], "agent");
    expect((await getPageConcepts(page.id))[0].rel).toBe("depends");
  });

  it("rejects an unknown rel", async () => {
    const page = await createTestPage(orgId, { slug: "rel-bad" });
    await expect(
      upsertConcepts(page.id, [{ term: T("bad"), rel: "bogus" as never }], "agent")
    ).rejects.toThrow(/concepts\[\]\.rel must be one of/);
  });

  it("create_page rejects an unknown rel before writing", async () => {
    await expect(
      dispatch(
        "create_page",
        { slug: "rel-bad-dispatch", content: "title: X\ncomponents: []\n", concepts: JSON.stringify([{ term: T("x"), rel: "bogus" }]) },
        orgId,
        "dep-org",
        "apikey-1",
        "user-1"
      )
    ).rejects.toThrow(/concepts\[\]\.rel must be one of/);
    expect(await testDb.page.findFirst({ where: { orgId, slug: "rel-bad-dispatch" } })).toBeNull();
  });
});

describe("upsertLinks keeps template lineage", () => {
  it("does not prune an instantiates link", async () => {
    const org = await createTestOrg({ name: "Prune Org", slug: "prune-org" });
    const from = await createTestPage(org.id, { slug: "instance" });
    const tmpl = await createTestPage(org.id, { slug: "tmpl" });
    await createTestPage(org.id, { slug: "target-a" });
    await testDb.pageLink.create({
      data: { fromPageId: from.id, toPageId: tmpl.id, rel: "instantiates", description: "{}", createdBy: "system" },
    });

    await upsertLinks(org.id, from.id, [{ target: "target-a", rel: "references" }], "agent");
    await upsertLinks(org.id, from.id, [], "agent");

    const remaining = await getPageLinks(org.id, from.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].rel).toBe("instantiates");
    expect(remaining[0].target).toBe("tmpl");
  });
});

describe("getDependents", () => {
  let orgId: string;

  beforeEach(async () => {
    const org = await createTestOrg({ name: "Graph Org", slug: "graph-org" });
    orgId = org.id;
  });

  it("by term: asserters, dependents, and gaps", async () => {
    const pricing = await createTestPage(orgId, { slug: "pricing-page", title: "Pricing" });
    const card = await createTestPage(orgId, { slug: "battle-card", title: "Battle card" });
    const faq = await createTestPage(orgId, { slug: "faq", title: "FAQ" });
    const other = await createTestPage(orgId, { slug: "unrelated", title: "Unrelated" });
    await upsertConcepts(pricing.id, [{ term: T("pricing/tier-2"), rel: "asserts" }], "agent");
    await upsertConcepts(card.id, [{ term: T("pricing/tier-2"), rel: "depends" }], "agent");
    await upsertConcepts(faq.id, [{ term: T("pricing/tier-2"), rel: "depends" }], "agent");
    await upsertConcepts(other.id, [{ term: T("pricing/tier-2"), rel: "references" }], "agent");
    await testDb.page.update({ where: { id: pricing.id }, data: { trustedVersionId: pricing.versions[0].id } });
    // Trust flags only mean something in locked mode; in the default auto
    // mode every page reads as trusted, same as read_page.
    await testDb.organization.update({ where: { id: orgId }, data: { rules: [{ kind: "trust", mode: "locked" }] } });

    const r = await getDependents(orgId, { term: T("pricing/tier-2") });
    expect(r.concept?.term).toBe(T("pricing/tier-2"));
    expect(r.asserters.map((a) => a.slug)).toEqual(["pricing-page"]);
    expect(r.asserters[0].trusted).toBe(true);
    expect(r.asserters[0].trustedBehind).toBe(false);
    expect(r.dependents.map((d) => d.slug).sort()).toEqual(["battle-card", "faq"]);
    expect(r.dependents[0].trusted).toBe(false);
    expect(r.asserterGaps).toEqual([]);

    const onlyDeps = await getDependents(orgId, { term: T("pricing/tier-2"), rel: "depends" });
    expect(onlyDeps.asserters).toEqual([]);
    expect(onlyDeps.dependents).toHaveLength(2);
  });

  it("by term: flags a concept with dependents and no asserter", async () => {
    const card = await createTestPage(orgId, { slug: "card-2" });
    await upsertConcepts(card.id, [{ term: T("orphan-concept"), rel: "depends" }], "agent");
    const r = await getDependents(orgId, { term: T("orphan-concept") });
    expect(r.asserterGaps).toEqual([T("orphan-concept")]);
  });

  it("by slug: what it depends on, what depends on it, and template instances", async () => {
    const pricing = await createTestPage(orgId, { slug: "pricing-2", title: "Pricing" });
    const stripe = await createTestPage(orgId, { slug: "stripe-doc", title: "Stripe" });
    const card = await createTestPage(orgId, { slug: "card-3", title: "Card" });
    const instance = await createTestPage(orgId, { slug: "pricing-2-copy", title: "Copy" });
    await upsertConcepts(pricing.id, [
      { term: T("tier-2"), rel: "asserts" },
      { term: T("stripe"), rel: "depends" },
      { term: T("nobody-owns"), rel: "depends" },
    ], "agent");
    await upsertConcepts(stripe.id, [{ term: T("stripe"), rel: "asserts" }], "agent");
    await upsertConcepts(card.id, [{ term: T("tier-2"), rel: "depends" }], "agent");
    await upsertConcepts(instance.id, [{ term: templateConceptTerm("pricing-2"), kind: "template", rel: "instantiates" }], "system");

    const r = await getDependents(orgId, { slug: "pricing-2" });
    expect(r.page?.slug).toBe("pricing-2");
    expect(r.concepts.map((c) => `${c.term}:${c.rel}`).sort()).toEqual([
      `${T("nobody-owns")}:depends`,
      `${T("stripe")}:depends`,
      `${T("tier-2")}:asserts`,
    ]);
    expect(r.asserters.map((a) => `${a.slug}<${a.via}`)).toEqual([`stripe-doc<${T("stripe")}`]);
    expect(r.dependents.map((d) => d.slug)).toEqual(["card-3"]);
    expect(r.instances.map((i) => i.slug)).toEqual(["pricing-2-copy"]);
    expect(r.asserterGaps).toEqual([T("nobody-owns")]);
  });

  it("excludes archived pages and other orgs", async () => {
    const otherOrg = await createTestOrg({ name: "Other", slug: "other-org" });
    const owner = await createTestPage(orgId, { slug: "owner" });
    const archived = await createTestPage(orgId, { slug: "archived-dep", status: "archived" });
    const foreign = await createTestPage(otherOrg.id, { slug: "foreign-dep" });
    await upsertConcepts(owner.id, [{ term: T("scoped"), rel: "asserts" }], "agent");
    await upsertConcepts(archived.id, [{ term: T("scoped"), rel: "depends" }], "agent");
    await upsertConcepts(foreign.id, [{ term: T("scoped"), rel: "depends" }], "agent");

    const r = await getDependents(orgId, { term: T("scoped") });
    expect(r.dependents).toEqual([]);
    expect(r.asserters).toHaveLength(1);
  });

  it("returns empty for unknown term or slug", async () => {
    const src = await createTestPage(orgId, { slug: "near-src" });
    await upsertConcepts(src.id, [{ term: T("pricing/tier-2"), rel: "asserts" }], "agent");
    await expect(getDependents(orgId, { term: T("tier-2-pricing") })).rejects.toThrow(/concept not found: dep-tier-2-pricing\. Did you mean: .*dep-pricing\/tier-2/);
    await expect(getDependents(orgId, { term: "zzz-nothing-like-this" })).rejects.toThrow(/get_vocabulary lists every concept/);
    expect((await getDependents(orgId, { slug: "no-such-page" })).concepts).toEqual([]);
  });
});

describe("create_from_template lineage", () => {
  it("tags the instance and links it to the template", async () => {
    const org = await createTestOrg({ name: "Tmpl Org", slug: "tmpl-org" });
    const templates = await testDb.folder.create({ data: { orgId: org.id, name: "templates", createdBy: "u" } });
    const tmpl = await createTestPage(org.id, {
      slug: "pov-roi",
      title: "POV ROI",
      folderId: templates.id,
      yamlContent: "title: ROI for {{customer}}\ncomponents:\n  - type: markdown\n    body: hello {{customer}}\n",
    });

    const out = (await dispatch(
      "create_from_template",
      { template_slug: "pov-roi", target_slug: "acme-roi", variables: JSON.stringify({ customer: "Acme" }) },
      org.id,
      org.slug,
      "apikey-1",
      "user-1"
    )) as Record<string, unknown>;
    expect(out.slug).toBe("acme-roi");
    expect(out.templateSlug).toBe("pov-roi");
    expect(out.templateHash).toBe(tmpl.versions[0].contentHash);

    const created = await testDb.page.findUnique({ where: { orgId_slug: { orgId: org.id, slug: "acme-roi" } } });
    expect(created).not.toBeNull();
    const concepts = await getPageConcepts(created!.id);
    expect(concepts).toEqual([{ term: "template/pov-roi", kind: "template", section: null, rel: "instantiates" }]);

    const links = await getPageLinks(org.id, created!.id);
    expect(links).toHaveLength(1);
    expect(links[0].target).toBe("pov-roi");
    expect(links[0].rel).toBe("instantiates");
    expect(JSON.parse(links[0].description!)).toEqual({ templateHash: tmpl.versions[0].contentHash, variables: { customer: "Acme" } });

    // The template's dependency view lists the instance.
    const deps = await getDependents(org.id, { slug: "pov-roi" });
    expect(deps.instances.map((i) => i.slug)).toEqual(["acme-roi"]);

    // A later write with its own links keeps the lineage.
    await upsertLinks(org.id, created!.id, [], "agent");
    expect(await getPageLinks(org.id, created!.id)).toHaveLength(1);
  });
});

describe("trust follows the org trust mode", () => {
  it("auto mode: every dependent reads trusted, none behind", async () => {
    const org = await createTestOrg({ name: "Auto Org", slug: "auto-org" });
    const src = await createTestPage(org.id, { slug: "src" });
    const dep = await createTestPage(org.id, { slug: "dep" });
    await upsertConcepts(src.id, [{ term: T("auto-term"), rel: "asserts" }], "agent");
    await upsertConcepts(dep.id, [{ term: T("auto-term"), rel: "depends" }], "agent");
    const r = await getDependents(org.id, { term: T("auto-term") });
    expect(r.dependents[0].trusted).toBe(true);
    expect(r.dependents[0].trustedBehind).toBe(false);
  });
});

describe("verifiedAt and staleAgainstSource", () => {
  let orgId: string;
  beforeEach(async () => {
    orgId = (await createTestOrg({ name: "Verify Org", slug: "verify-org" })).id;
  });

  it("a dependent verified before the source moved is stale; mark_verified clears it", async () => {
    const src = await createTestPage(orgId, { slug: "spec" });
    const dep = await createTestPage(orgId, { slug: "deck-notes" });
    await upsertConcepts(src.id, [{ term: T("feat/grouping"), rel: "asserts" }], "agent");
    await upsertConcepts(dep.id, [{ term: T("feat/grouping"), rel: "depends" }], "agent");
    const old = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    await testDb.pageConcept.updateMany({ where: { pageId: dep.id }, data: { verifiedAt: old } });
    await testDb.page.update({ where: { id: src.id }, data: { updatedAt: new Date() } });

    let r = await getDependents(orgId, { term: T("feat/grouping") });
    expect(r.dependents[0].verifiedAt).toBe(old.toISOString());
    expect(r.dependents[0].staleAgainstSource).toBe(true);
    expect(r.asserters[0].staleAgainstSource).toBe(false);

    const v = await verifyDependent(orgId, { slug: "deck-notes", note: "does not mention grouping" });
    expect(v.kind).toBe("page");
    r = await getDependents(orgId, { term: T("feat/grouping") });
    expect(r.dependents[0].staleAgainstSource).toBe(false);
    expect(r.dependents[0].verifiedNote).toBe("does not mention grouping");
    expect(r.summary.pages).toEqual({ total: 1, ok: 1, stale: 0, needsChange: 0, neverVerified: 0 });

    // A rewrite speaks for itself: the note from the last verification goes.
    await dispatch("write_page", { slug: "deck-notes", content: "title: Deck notes\nshell: document\ncomponents: []\n" }, orgId, "verify-org", "key", "u1");
    r = await getDependents(orgId, { term: T("feat/grouping") });
    expect(r.dependents[0].verifiedNote).toBeNull();
  });

  it("never-verified dependent with a source is stale; with no source it is not", async () => {
    const dep = await createTestPage(orgId, { slug: "lonely" });
    await upsertConcepts(dep.id, [{ term: T("no-source"), rel: "depends" }], "agent", { verified: false });
    const r = await getDependents(orgId, { term: T("no-source") });
    expect(r.dependents[0].verifiedAt).toBeNull();
    expect(r.dependents[0].staleAgainstSource).toBe(false);
  });

  it("write_page and mark_trusted both bump every edge on the page and clear needs_change", async () => {
    const page = await createTestPage(orgId, { slug: "bump-me" });
    await upsertConcepts(page.id, [{ term: T("bump/a"), rel: "depends" }, { term: T("bump/b"), rel: "depends" }], "agent", { verified: false });
    await testDb.pageConcept.updateMany({ where: { pageId: page.id }, data: { needsChange: true, verifiedNote: "wrong" } });
    await dispatch("write_page", { slug: "bump-me", content: "title: Bump\nshell: document\ncomponents: []\n" }, orgId, "verify-org", "key", "u1");
    let edges = await testDb.pageConcept.findMany({ where: { pageId: page.id } });
    expect(edges).toHaveLength(2);
    for (const e of edges) { expect(e.verifiedAt).not.toBeNull(); expect(e.needsChange).toBe(false); expect(e.verifiedNote).toBeNull(); }

    await testDb.pageConcept.updateMany({ where: { pageId: page.id }, data: { verifiedAt: null } });
    await testDb.organization.update({ where: { id: orgId }, data: { rules: [{ kind: "trust", mode: "locked" }] } });
    await dispatch("mark_trusted", { slug: "bump-me" }, orgId, "verify-org", "key", "u1");
    edges = await testDb.pageConcept.findMany({ where: { pageId: page.id } });
    for (const e of edges) expect(e.verifiedAt).not.toBeNull();
  });

  it("verification is per edge: verifying for one concept leaves the other alone", async () => {
    const pricing = await createTestPage(orgId, { slug: "pricing-src" });
    const tagline = await createTestPage(orgId, { slug: "tagline-src" });
    const onePager = await createTestPage(orgId, { slug: "one-pager-x" });
    await upsertConcepts(pricing.id, [{ term: T("edge/pricing"), rel: "asserts" }], "agent");
    await upsertConcepts(tagline.id, [{ term: T("edge/tagline"), rel: "asserts" }], "agent");
    await mapDependencies(orgId, { term: T("edge/pricing"), depends: ["one-pager-x"] }, "agent");
    await mapDependencies(orgId, { term: T("edge/tagline"), depends: ["one-pager-x"] }, "agent");

    let byTagline = await getDependents(orgId, { term: T("edge/tagline") });
    expect(byTagline.dependents[0].verifiedAt).toBeNull();
    expect(byTagline.summary.pages.neverVerified).toBe(1);

    const v = await verifyDependent(orgId, { slug: "one-pager-x", term: T("edge/pricing"), note: "does not quote the price" });
    expect(v.count).toBe(1);
    expect(v.term).toBe(T("edge/pricing"));

    const byPricing = await getDependents(orgId, { term: T("edge/pricing") });
    expect(byPricing.dependents[0].staleAgainstSource).toBe(false);
    expect(byPricing.dependents[0].verifiedNote).toBe("does not quote the price");
    byTagline = await getDependents(orgId, { term: T("edge/tagline") });
    expect(byTagline.dependents[0].staleAgainstSource).toBe(true);
    expect(byTagline.dependents[0].verifiedNote).toBeNull();

    // slug alone covers every edge; a term the page is not tagged with errors.
    const all = await verifyDependent(orgId, { slug: "one-pager-x" });
    expect(all.count).toBe(2);
    await expect(verifyDependent(orgId, { slug: "one-pager-x", term: T("edge/nope") })).rejects.toThrow(/concept not found/);
  });

  it("needs_change reads as needs update until a holds or a write", async () => {
    const src = await createTestPage(orgId, { slug: "nc-src" });
    const dep = await createTestPage(orgId, { slug: "nc-dep" });
    await upsertConcepts(src.id, [{ term: T("nc/term"), rel: "asserts" }], "agent");
    await upsertConcepts(dep.id, [{ term: T("nc/term"), rel: "depends" }], "agent");
    await verifyDependent(orgId, { slug: "nc-dep", term: T("nc/term"), status: "needs_change", note: "still says the old thing" });
    let r = await getDependents(orgId, { term: T("nc/term") });
    expect(r.dependents[0].needsChange).toBe(true);
    expect(r.dependents[0].staleAgainstSource).toBe(true);
    expect(r.summary.pages.needsChange).toBe(1);
    expect(r.summary.text).toBe("1 of 1 need a look: 1 needs an update.");
    await verifyDependent(orgId, { slug: "nc-dep", term: T("nc/term"), status: "holds" });
    r = await getDependents(orgId, { term: T("nc/term") });
    expect(r.dependents[0].needsChange).toBe(false);
    expect(r.dependents[0].staleAgainstSource).toBe(false);
    await expect(dispatch("mark_verified", { slug: "nc-dep", status: "bogus" }, orgId, "verify-org", "key", "u1")).rejects.toThrow(/status must be one of/);
  });
});

describe("external dependents", () => {
  let orgId: string;
  beforeEach(async () => {
    orgId = (await createTestOrg({ name: "Ext Org", slug: "ext-org" })).id;
  });

  it("normalizes urls so share-link variants collapse", () => {
    expect(normalizeExternalUrl("https://docs.google.com/presentation/d/ABC/edit?usp=sharing#slide=9"))
      .toBe("https://docs.google.com/presentation/d/ABC");
    expect(normalizeExternalUrl("https://docs.google.com/presentation/d/ABC/view"))
      .toBe("https://docs.google.com/presentation/d/ABC");
    expect(normalizeExternalUrl("https://GitHub.com/mazehq/atlas/blob/main/README.md#quickstart"))
      .toBe("https://github.com/mazehq/atlas/blob/main/README.md");
    expect(() => normalizeExternalUrl("not a url")).toThrow(/absolute http/);
    expect(() => normalizeExternalUrl("ftp://x/y")).toThrow(/http/);
  });

  it("attaches to the concept, dedupes by url, shows up inline in get_dependents", async () => {
    const src = await createTestPage(orgId, { slug: "pricing" });
    await upsertConcepts(src.id, [{ term: T("ext/tier-2"), rel: "asserts" }], "agent");
    const rows = await upsertExternalDependents(orgId, T("ext/tier-2"), [
      { url: "https://docs.google.com/presentation/d/DECK/edit", label: "Sales deck", owner: "Sales" },
      { url: "https://docs.google.com/presentation/d/DECK/view", label: "Sales deck (dup)" },
      { url: "https://github.com/mazehq/atlas/blob/main/README.md" },
    ], "agent");
    expect(rows).toHaveLength(3);
    const stored = await testDb.externalAsset.findMany({ where: { orgId } });
    expect(stored).toHaveLength(2);
    const deck = stored.find((r) => r.url.includes("DECK"))!;
    expect(deck.label).toBe("Sales deck (dup)");
    expect(deck.owner).toBe("Sales");

    const r = await getDependents(orgId, { term: T("ext/tier-2") });
    expect(r.external.map((e) => e.host).sort()).toEqual(["docs.google.com", "github.com"]);
    expect(r.external[0].via).toBe(T("ext/tier-2"));
    // Attaching is not checking: a fresh asset reads never checked, and stale.
    expect(r.external[0].verifiedAt).toBeNull();
    expect(r.external[0].staleAgainstSource).toBe(true);
    expect(r.summary.external).toEqual({ total: 2, ok: 0, stale: 0, needsChange: 0, neverChecked: 2 });
    expect(r.summary.text).toBe("2 of 2 need a look: 2 never checked.");

    const bySlug = await getDependents(orgId, { slug: "pricing" });
    expect(bySlug.external).toHaveLength(2);
  });

  it("goes stale when the source moves and mark_verified by url clears it", async () => {
    const src = await createTestPage(orgId, { slug: "spec-2" });
    await upsertConcepts(src.id, [{ term: T("ext/stale"), rel: "asserts" }], "agent");
    await upsertExternalDependents(orgId, T("ext/stale"), [{ url: "https://example.com/deck" }], "agent");
    await testDb.externalEdge.updateMany({ where: { asset: { orgId } }, data: { verifiedAt: new Date(Date.now() - 86400_000) } });
    await testDb.page.update({ where: { id: src.id }, data: { updatedAt: new Date() } });
    let r = await getDependents(orgId, { term: T("ext/stale") });
    expect(r.external[0].staleAgainstSource).toBe(true);
    expect(r.summary.text).toBe("1 of 1 need a look: 1 not checked since the source changed.");

    const v = await dispatch("mark_verified", { url: "https://example.com/deck/", note: "deck still says $59, ticket filed" }, orgId, "ext-org", "key", "u1") as { kind: string; count: number; note: string };
    expect(v.kind).toBe("external");
    expect(v.count).toBe(1);
    expect(v.note).toBe("deck still says $59, ticket filed");
    r = await getDependents(orgId, { term: T("ext/stale") });
    expect(r.external[0].staleAgainstSource).toBe(false);
    expect(r.external[0].verifiedNote).toBe("deck still says $59, ticket filed");
  });

  it("one asset, many edges: the same url on two concepts shares label/owner and keeps separate verification", async () => {
    await upsertExternalDependents(orgId, T("ext/a"), [{ url: "https://example.com/shared", label: "Shared deck", owner: "Sales" }], "agent");
    await upsertExternalDependents(orgId, T("ext/b"), [{ url: "https://example.com/shared/" }], "agent");
    expect(await testDb.externalAsset.count({ where: { orgId, url: "https://example.com/shared" } })).toBe(1);
    expect(await testDb.externalEdge.count({ where: { asset: { orgId, url: "https://example.com/shared" } } })).toBe(2);

    const v = await verifyDependent(orgId, { url: "https://example.com/shared", term: T("ext/a"), note: "a is fine" });
    expect(v.count).toBe(1);
    const a = await getDependents(orgId, { term: T("ext/a") });
    const b = await getDependents(orgId, { term: T("ext/b") });
    expect(a.external[0].label).toBe("Shared deck");
    expect(b.external[0].label).toBe("Shared deck");
    expect(a.external[0].verifiedNote).toBe("a is fine");
    expect(b.external[0].verifiedAt).toBeNull();
    expect(a.external[0].alsoDependsOn).toEqual([T("ext/b")]);
    expect(b.external[0].alsoDependsOn).toEqual([T("ext/a")]);

    // url alone covers every edge on the asset.
    expect((await verifyDependent(orgId, { url: "https://example.com/shared" })).count).toBe(2);
    // needs_change on an external counts separately.
    await verifyDependent(orgId, { url: "https://example.com/shared", term: T("ext/b"), status: "needs_change", note: "old tagline" });
    const b2 = await getDependents(orgId, { term: T("ext/b") });
    expect(b2.external[0].needsChange).toBe(true);
    expect(b2.summary.text).toBe("1 of 1 need a look: 1 needs an update.");
  });

  it("remove detaches, and a concept with only external dependents still reports the asserter gap", async () => {
    await upsertExternalDependents(orgId, T("ext/orphan"), [{ url: "https://example.com/a" }, { url: "https://example.com/b" }], "agent");
    let r = await getDependents(orgId, { term: T("ext/orphan") });
    expect(r.external).toHaveLength(2);
    expect(r.asserterGaps).toEqual([T("ext/orphan")]);
    await upsertExternalDependents(orgId, T("ext/orphan"), [{ url: "https://example.com/a", remove: true }], "agent");
    r = await getDependents(orgId, { term: T("ext/orphan") });
    expect(r.external.map((e) => e.url)).toEqual(["https://example.com/b"]);
    // Asset with no edges left is gone.
    expect(await testDb.externalAsset.count({ where: { orgId, url: "https://example.com/a" } })).toBe(0);
  });
});

describe("map_dependencies", () => {
  it("builds a graph in one call and reports unknown slugs instead of failing", async () => {
    const org = await createTestOrg({ name: "Map Org", slug: "map-org" });
    await createTestPage(org.id, { slug: "launch-brief" });
    await createTestPage(org.id, { slug: "release-notes" });
    await createTestPage(org.id, { slug: "one-pager" });
    const out = await mapDependencies(org.id, {
      term: T("map/launch"),
      kind: "feature",
      asserts: ["launch-brief"],
      depends: ["release-notes", "one-pager", "does-not-exist"],
      external: [{ url: "https://docs.google.com/document/d/X/edit", label: "PR draft" }],
    }, "agent");
    expect(out.term).toBe(T("map/launch"));
    expect(out.tagged).toEqual([
      { slug: "launch-brief", rel: "asserts" },
      { slug: "release-notes", rel: "depends" },
      { slug: "one-pager", rel: "depends" },
    ]);
    expect(out.missing).toEqual(["does-not-exist"]);
    expect(out.external).toHaveLength(1);

    const r = await getDependents(org.id, { term: T("map/launch") });
    expect(r.concept?.kind).toBe("feature");
    expect(r.asserters.map((a) => a.slug)).toEqual(["launch-brief"]);
    expect(r.dependents.map((d) => d.slug).sort()).toEqual(["one-pager", "release-notes"]);
    expect(r.external[0].label).toBe("PR draft");
  });

  it("dispatch accepts JSON arrays for the slug lists and external", async () => {
    const org = await createTestOrg({ name: "Map Org 2", slug: "map-org-2" });
    await createTestPage(org.id, { slug: "src-page" });
    const out = await dispatch("map_dependencies", {
      term: T("map/dispatch"),
      asserts: JSON.stringify(["src-page"]),
      external: JSON.stringify([{ url: "https://example.com/x" }]),
    }, org.id, "map-org-2", "key", "u1") as { tagged: unknown[]; external: unknown[] };
    expect(out.tagged).toHaveLength(1);
    expect(out.external).toHaveLength(1);
    await expect(dispatch("map_dependencies", { term: T("map/empty") }, org.id, "map-org-2", "key", "u1")).rejects.toThrow(/nothing to map/);
    await expect(dispatch("map_dependencies", { term: T("map/bad"), external: JSON.stringify([{ nope: 1 }]) }, org.id, "map-org-2", "key", "u1")).rejects.toThrow(/url is required/);
  });
});

describe("REST ergonomics the cold agent tripped on", () => {
  it("search_pages resolves to search, and yaml is accepted for content", async () => {
    const org = await createTestOrg({ name: "Alias Org", slug: "alias-org" });
    await expect(dispatch("search_pages", { query: "anything" }, org.id, "alias-org", "key", "u1")).resolves.toBeDefined();
    const r = await dispatch("create_page", { slug: "alias-page", yaml: "title: Alias\nshell: document\ncomponents: []\n" }, org.id, "alias-org", "key", "u1") as { ok: boolean };
    expect(r.ok).toBe(true);
    const params = describeToolParams("search_pages");
    expect(params).toContain("query");
    expect(describeToolParams("map_dependencies")).toEqual(expect.arrayContaining(["term", "asserts", "depends", "external"]));
  });
});

describe("listConceptMaps", () => {
  it("ranks concepts by how much still needs a look and skips concepts with nothing attached", async () => {
    const org = await createTestOrg({ name: "Map Index Org", slug: "map-index-org" });
    const a = await createTestPage(org.id, { slug: "src-a" });
    const b = await createTestPage(org.id, { slug: "src-b" });
    await createTestPage(org.id, { slug: "dep-1" });
    await createTestPage(org.id, { slug: "dep-2" });
    await createTestPage(org.id, { slug: "dep-3" });
    await upsertConcepts(a.id, [{ term: T("idx/a"), rel: "asserts" }], "agent");
    await upsertConcepts(b.id, [{ term: T("idx/b"), rel: "asserts" }], "agent");
    await mapDependencies(org.id, { term: T("idx/a"), depends: ["dep-1"], external: [{ url: "https://example.com/x" }] }, "agent");
    await mapDependencies(org.id, { term: T("idx/b"), depends: ["dep-2", "dep-3"] }, "agent");
    await verifyDependent(org.id, { slug: "dep-1", term: T("idx/a") });
    // A concept only referenced, never depended on, stays off the map.
    const ref = await createTestPage(org.id, { slug: "ref-only" });
    await upsertConcepts(ref.id, [{ term: T("idx/ref"), rel: "references" }], "agent");

    const rows = await listConceptMaps(org.id);
    expect(rows.map((r) => r.term)).toEqual([T("idx/b"), T("idx/a")]);
    expect(rows[0]).toMatchObject({ needsLook: 2, total: 2, sources: [expect.objectContaining({ slug: "src-b" })] });
    expect(rows[1]).toMatchObject({ needsLook: 1, total: 2 });
    expect(rows[1].summary.external.neverChecked).toBe(1);
  });
});

describe("includeMap: sub-maps and per-context verification", () => {
  let orgId: string;
  beforeEach(async () => {
    orgId = (await createTestOrg({ name: "Tree Org", slug: "tree-org" })).id;
  });

  it("refuses a cycle and self-include", async () => {
    await upsertConcepts((await createTestPage(orgId, { slug: "tree-a-src" })).id, [{ term: T("tree/a"), rel: "asserts" }], "agent");
    await upsertConcepts((await createTestPage(orgId, { slug: "tree-b-src" })).id, [{ term: T("tree/b"), rel: "asserts" }], "agent");
    await expect(includeMap(orgId, T("tree/a"), T("tree/a"), "agent")).rejects.toThrow(/cannot include itself/);
    await includeMap(orgId, T("tree/a"), T("tree/b"), "agent");
    await expect(includeMap(orgId, T("tree/b"), T("tree/a"), "agent")).rejects.toThrow(/would create a cycle/);
  });

  it("includes a group's depends+external into the parent view, tagged with group, and dedupes a shared leaf", async () => {
    const groupSrc = await createTestPage(orgId, { slug: "grp-src" });
    await createTestPage(orgId, { slug: "grp-shared" });
    await upsertConcepts(groupSrc.id, [{ term: T("group/sales"), rel: "asserts" }], "agent");
    await mapDependencies(orgId, {
      term: T("group/sales"),
      depends: ["grp-shared"],
      external: [{ url: "https://example.com/deck" }],
    }, "agent");

    const launchSrc = await createTestPage(orgId, { slug: "launch-src" });
    await createTestPage(orgId, { slug: "launch-own" });
    await upsertConcepts(launchSrc.id, [{ term: T("launch/sso"), rel: "asserts" }], "agent");
    const mapped = await mapDependencies(orgId, {
      term: T("launch/sso"),
      depends: ["launch-own"],
      includes: [T("group/sales")],
    }, "agent");
    expect(mapped.includes).toEqual([T("group/sales")]);
    expect(mapped.missingIncludes).toEqual([]);

    const r = await getDependents(orgId, { term: T("launch/sso") });
    expect(r.truncated).toBe(false);
    expect(r.includes.map((i) => i.term)).toEqual([T("group/sales")]);
    const slugs = r.dependents.map((d) => d.slug).sort();
    expect(slugs).toEqual(["grp-shared", "launch-own"]);
    const sharedRow = r.dependents.find((d) => d.slug === "grp-shared")!;
    expect(sharedRow.group).toBe(T("group/sales"));
    expect(r.external.map((e) => e.url)).toEqual(["https://example.com/deck"]);
    expect(r.external[0].group).toBe(T("group/sales"));
    // Reached only once even though it's in the group; own edges aren't tagged.
    const ownRow = r.dependents.find((d) => d.slug === "launch-own")!;
    expect(ownRow.group).toBeUndefined();
  });

  it("verifying a shared group's leaf for one launch does not paint it verified for another", async () => {
    const groupSrc = await createTestPage(orgId, { slug: "ctx-grp-src" });
    const shared = await createTestPage(orgId, { slug: "ctx-shared" });
    await upsertConcepts(groupSrc.id, [{ term: T("group/ctx"), rel: "asserts" }], "agent");
    await mapDependencies(orgId, { term: T("group/ctx"), depends: ["ctx-shared"] }, "agent");

    const aSrc = await createTestPage(orgId, { slug: "ctx-a-src" });
    const bSrc = await createTestPage(orgId, { slug: "ctx-b-src" });
    await upsertConcepts(aSrc.id, [{ term: T("launch/a"), rel: "asserts" }], "agent");
    await upsertConcepts(bSrc.id, [{ term: T("launch/b"), rel: "asserts" }], "agent");
    await mapDependencies(orgId, { term: T("launch/a"), includes: [T("group/ctx")] }, "agent");
    await mapDependencies(orgId, { term: T("launch/b"), includes: [T("group/ctx")] }, "agent");

    let ra = await getDependents(orgId, { term: T("launch/a") });
    let rb = await getDependents(orgId, { term: T("launch/b") });
    expect(ra.dependents[0].verifiedAt).toBeNull();
    expect(rb.dependents[0].verifiedAt).toBeNull();

    // Verify for launch/a specifically (context = launch/a's term).
    const v = await verifyDependent(orgId, { slug: "ctx-shared", term: T("group/ctx"), context: T("launch/a"), note: "checked for a" });
    expect(v.context).toBe(T("launch/a"));
    expect(v.count).toBe(1);

    ra = await getDependents(orgId, { term: T("launch/a") });
    rb = await getDependents(orgId, { term: T("launch/b") });
    expect(ra.dependents[0].staleAgainstSource).toBe(false);
    expect(ra.dependents[0].verifiedNote).toBe("checked for a");
    // launch/b sees the same leaf as still never-checked, not verified.
    expect(rb.dependents[0].verifiedAt).toBeNull();
    expect(rb.dependents[0].staleAgainstSource).toBe(true);

    // Viewing the group directly is unaffected by either context write.
    const rg = await getDependents(orgId, { term: T("group/ctx") });
    expect(rg.dependents[0].verifiedAt).toBeNull();

    // context without term is rejected.
    await expect(verifyDependent(orgId, { slug: "ctx-shared", context: T("launch/a") })).rejects.toThrow(/term is required when context/);
  });

  it("removeIncludes detaches a sub-map", async () => {
    await upsertConcepts((await createTestPage(orgId, { slug: "ri-grp-src" })).id, [{ term: T("group/ri"), rel: "asserts" }], "agent");
    await mapDependencies(orgId, { term: T("group/ri"), depends: ["ri-grp-src"] }, "agent");
    await upsertConcepts((await createTestPage(orgId, { slug: "ri-root-src" })).id, [{ term: T("launch/ri"), rel: "asserts" }], "agent");
    await mapDependencies(orgId, { term: T("launch/ri"), includes: [T("group/ri")] }, "agent");
    expect((await getDependents(orgId, { term: T("launch/ri") })).includes).toHaveLength(1);
    await mapDependencies(orgId, { term: T("launch/ri"), removeIncludes: [T("group/ri")] }, "agent");
    expect((await getDependents(orgId, { term: T("launch/ri") })).includes).toHaveLength(0);
  });

  it("mapDependencies reports an unresolved include term instead of failing the call", async () => {
    await upsertConcepts((await createTestPage(orgId, { slug: "mi-src" })).id, [{ term: T("launch/mi"), rel: "asserts" }], "agent");
    const r = await mapDependencies(orgId, { term: T("launch/mi"), includes: [T("group/does-not-exist")] }, "agent");
    expect(r.missingIncludes).toEqual([T("group/does-not-exist")]);
  });
});
