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
} from "@/lib/concepts";
import { dispatch } from "@/lib/mcp-dispatch";
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
    expect((await getDependents(orgId, { term: T("never-seen") })).dependents).toEqual([]);
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
