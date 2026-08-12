import { describe, it, expect, beforeEach, vi } from "vitest";
import { testDb } from "./setup";
import { createTestOrg, createTestPage } from "./helpers";

// Mock db to use test database
vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});

import { buildServerInstructions } from "@/lib/mcp-instructions";

async function tagPage(pageId: string, name: string) {
  const concept = await testDb.concept.upsert({
    where: { normalizedName: name },
    update: { usageCount: { increment: 1 } },
    create: { normalizedName: name, displayName: name, kind: "topic" },
  });
  await testDb.pageConcept.create({
    data: { pageId, conceptId: concept.id, createdBy: "test-user" },
  });
}

describe("buildServerInstructions", () => {
  let orgId: string;

  beforeEach(async () => {
    const org = await createTestOrg({
      name: "Brain Org",
      slug: "brain-org",
      rules: [
        { id: "no-em-dash", text: "No em dashes, use hyphens", mode: "block", patterns: ["—"] },
        { id: "tone", text: "Casual professional voice" },
      ],
    });
    orgId = org.id;
  });

  it("always includes the base behavior sections", async () => {
    const out = await buildServerInstructions(orgId, "brain-org");
    expect(out).toContain("WHEN TO SEARCH");
    expect(out).toContain("WHEN TO CAPTURE");
    expect(out).toContain('"brain-org"');
  });

  it("builds the brain map from tagged pages with counts, token cost, and samples", async () => {
    const faq1 = await createTestPage(orgId, {
      slug: "faq-sso",
      title: "SSO cert rotation",
      yamlContent: "title: SSO cert rotation\nshell: document\ncomponents: []\n",
    });
    const faq2 = await createTestPage(orgId, { slug: "faq-pricing", title: "Pricing structure" });
    const how = await createTestPage(orgId, { slug: "how-capture", title: "Capture pipeline" });
    await tagPage(faq1.id, "customer-faq");
    await tagPage(faq2.id, "customer-faq");
    await tagPage(how.id, "how-it-works");
    // Untagged page must stay invisible in the map
    await createTestPage(orgId, { slug: "untagged", title: "Untagged Secret Draft" });

    const out = await buildServerInstructions(orgId, "brain-org");

    expect(out).toContain("BRAIN MAP");
    expect(out).toMatch(/customer-faq\t2\t\d+\t/);
    expect(out).toMatch(/how-it-works\t1\t\d+\t/);
    expect(out).toContain('"SSO cert rotation"');
    expect(out).not.toContain("Untagged Secret Draft");
    // Token estimate is chars/4 of current version content — always positive
    const tokens = Number(out.match(/customer-faq\t2\t(\d+)\t/)?.[1]);
    expect(tokens).toBeGreaterThan(0);
  });

  it("excludes archived pages from the map", async () => {
    const page = await createTestPage(orgId, {
      slug: "old-faq",
      title: "Archived Answer",
      status: "archived",
    });
    await tagPage(page.id, "customer-faq");

    const out = await buildServerInstructions(orgId, "brain-org");
    expect(out).not.toContain("Archived Answer");
  });

  it("omits the brain map section when nothing is tagged", async () => {
    await createTestPage(orgId, { slug: "lonely", title: "Lonely Page" });
    const out = await buildServerInstructions(orgId, "brain-org");
    expect(out).not.toContain("BRAIN MAP");
  });

  it("surfaces org rule texts, including pattern-less instruction rules", async () => {
    const out = await buildServerInstructions(orgId, "brain-org");
    expect(out).toContain("ORG RULES");
    expect(out).toContain("- No em dashes, use hyphens");
    expect(out).toContain("- Casual professional voice");
  });

  it("does not leak other orgs' tags into the map", async () => {
    const other = await createTestOrg({ name: "Other Org", slug: "other-org" });
    const foreign = await createTestPage(other.id, { slug: "foreign", title: "Foreign Page" });
    await tagPage(foreign.id, "customer-faq");

    const out = await buildServerInstructions(orgId, "brain-org");
    expect(out).not.toContain("BRAIN MAP");
    expect(out).not.toContain("Foreign Page");
  });
});
