import { describe, it, expect, vi } from "vitest";
import { createTestOrg, createTestPage } from "./helpers";

vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});
vi.mock("@/lib/kazam", () => ({ validateYaml: async () => ({ valid: true, errors: [] }), hasSchemaFor: () => false, getBaseKazamSchema: () => null }));

import { testDb } from "./setup";
import { writePage } from "@/lib/pages";
import { upsertConcepts, verifyDependent } from "@/lib/concepts";
import { getChartNode } from "@/lib/chart";
import { addScopeItem, getAuditList, getScopeSuggestions, parseCheckRecipe, removeScopeItem, suggestCheck, updateScopeItem } from "@/lib/scope";

describe("scope", () => {
  it("suggests URLs from the source body and children's bodies, adds one with a recipe, edits owner/due, audits, removes", async () => {
    const org = await createTestOrg({ name: "Scope Org", slug: "scope-org" });
    await writePage(org.id, org.slug, "pricing", `title: Pricing\ncomponents:\n  - type: markdown\n    content: live at https://app.hubspot.com/pages/123 and https://dashboard.stripe.com/prices/p1\n`, "tester");
    const pricing = await testDb.page.findUnique({ where: { orgId_slug: { orgId: org.id, slug: "pricing" } } });
    await upsertConcepts(pricing!.id, [{ term: "scope/pricing", rel: "asserts" }], "tester");
    for (const slug of ["a", "b", "c"]) {
      await writePage(org.id, org.slug, `dep-${slug}`, `title: ${slug}\ncomponents:\n  - type: markdown\n    content: see https://docs.google.com/presentation/d/deck1/edit\n`, "tester");
      const p = await testDb.page.findUnique({ where: { orgId_slug: { orgId: org.id, slug: `dep-${slug}` } } });
      await upsertConcepts(p!.id, [{ term: "scope/pricing", rel: "depends" }], "tester");
    }

    const sug = await getScopeSuggestions(org.id, "scope/pricing");
    const byUrl = new Map(sug.map((s) => [s.url, s]));
    expect(byUrl.get("https://app.hubspot.com/pages/123")?.why).toBe("in source body");
    expect(byUrl.get("https://app.hubspot.com/pages/123")?.suggestedCheck?.via).toBe("hubspot");
    expect(byUrl.get("https://docs.google.com/presentation/d/deck1")?.why).toBe("in a child's body");
    expect(byUrl.get("https://docs.google.com/presentation/d/deck1")?.referencedBy).toBe(3);
    expect(byUrl.get("https://dashboard.stripe.com/prices/p1")?.suggestedCheck).toBeNull();

    // Add the deck with its suggested recipe and a due date in the past.
    const child = await addScopeItem(org.id, "scope/pricing", {
      url: "https://docs.google.com/presentation/d/deck1/edit?usp=sharing",
      label: "Sales deck", owner: "Tyler", dueAt: "2020-01-01",
      check: suggestCheck("https://docs.google.com/presentation/d/deck1"),
    }, "tester");
    expect(child.kind).toBe("external");
    expect(child.url).toBe("https://docs.google.com/presentation/d/deck1");
    expect(child.owner).toBe("Tyler");
    expect(child.color).toBe("red");
    expect(child.reason).toBe("past due");
    expect((child.check as { via: string }).via).toBe("google-drive");

    // Suggestion list no longer offers what's declared.
    expect((await getScopeSuggestions(org.id, "scope/pricing")).some((s) => s.url === child.url)).toBe(false);

    // Add a second external with no recipe: it lands in the human bucket of the audit.
    await addScopeItem(org.id, "scope/pricing", { url: "https://dashboard.stripe.com/prices/p1", owner: "Finance" }, "tester");
    const audit = await getAuditList(org.id);
    expect(audit.withRecipe.map((a) => a.url)).toEqual(["https://docs.google.com/presentation/d/deck1"]);
    expect(audit.humanOnly.map((a) => a.url)).toEqual(["https://dashboard.stripe.com/prices/p1"]);
    expect(audit.humanOnly[0].suggestedCheck).toBeNull();

    // Clearing the due date and checking it turns the deck green.
    await updateScopeItem(org.id, { url: child.url!, term: "scope/pricing", dueAt: null, owner: "Sam" });
    await verifyDependent(org.id, { url: child.url!, term: "scope/pricing" });
    let node = await getChartNode(org.id, "scope/pricing");
    const deck = node.children.find((c) => c.url === child.url)!;
    expect(deck.color).toBe("green");
    expect(deck.owner).toBe("Sam");
    expect(deck.dueAt).toBeNull();

    // A bad recipe is refused before any write.
    await expect(updateScopeItem(org.id, { url: child.url!, check: { tool: "x" } })).rejects.toThrow(/check\.via is required/);
    expect(parseCheckRecipe(null)).toBeNull();

    // Adding a page by slug and removing both kinds.
    const extra = await createTestPage(org.id, { slug: "extra-page", title: "Extra" });
    const added = await addScopeItem(org.id, "scope/pricing", { slug: "extra-page" }, "tester");
    expect(added.kind).toBe("page");
    expect(added.color).toBe("yellow");
    await removeScopeItem(org.id, "scope/pricing", { slug: "extra-page" }, "tester");
    await removeScopeItem(org.id, "scope/pricing", { url: child.url! }, "tester");
    node = await getChartNode(org.id, "scope/pricing");
    expect(node.children.some((c) => c.slug === "extra-page" || c.url === child.url)).toBe(false);
    expect(extra.id).toBeTruthy();
  });
});
