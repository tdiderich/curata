import { describe, it, expect, beforeEach, vi } from "vitest";
import { testDb } from "./setup";
import { createTestOrg } from "./helpers";

// Mock db to use test database
vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});

import { ensureSeedPages, seedOrgContent } from "@/lib/seed";
import { dispatch } from "@/lib/mcp-dispatch";

// No filesystem/browser side effects from tools unrelated to seeding.
vi.mock("@/lib/kazam", async () => {
  const os = await import("os");
  const path = await import("path");
  const tmpDir = path.join(os.tmpdir(), `curata-test-seed-${process.pid}`);
  return {
    sitePath: () => tmpDir,
    buildSite: vi.fn().mockResolvedValue(""),
    validateContent: vi.fn().mockResolvedValue([]),
    checkUnsupportedComponents: vi.fn().mockReturnValue([]),
    invalidContentMessage: (d: string) => d,
  };
});

describe("ensureSeedPages backfill", () => {
  let orgId: string;

  beforeEach(async () => {
    const org = await createTestOrg({ name: "Backfill Org", slug: `backfill-org-${Math.random().toString(36).slice(2)}` });
    orgId = org.id;
  });

  it("backfills missing seed pages onto an org that never got them (no seed run at creation)", async () => {
    const before = await testDb.page.findUnique({ where: { orgId_slug: { orgId, slug: "getting-started" } } });
    expect(before).toBeNull();

    await ensureSeedPages(orgId);

    const after = await testDb.page.findUnique({ where: { orgId_slug: { orgId, slug: "getting-started" } } });
    expect(after).not.toBeNull();

    // A skill page from the workflows seed dir should also have landed.
    const skillPage = await testDb.page.findUnique({ where: { orgId_slug: { orgId, slug: "curata-scout-repos" } } });
    expect(skillPage).not.toBeNull();
  });

  it("never overwrites an existing page with the same slug, including a customized one", async () => {
    const customYaml = "title: My Customized Getting Started\nshell: document\ncomponents:\n  - type: markdown\n    body: our own words\n";
    await testDb.page.create({
      data: {
        orgId,
        slug: "getting-started",
        title: "My Customized Getting Started",
        createdBy: "human",
        versions: { create: { yamlContent: customYaml, contentHash: "custom-hash", createdBy: "human" } },
      },
    });

    await ensureSeedPages(orgId);

    const page = await testDb.page.findUnique({
      where: { orgId_slug: { orgId, slug: "getting-started" } },
      include: { versions: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    expect(page?.title).toBe("My Customized Getting Started");
    expect(page?.versions[0].yamlContent).toBe(customYaml);
  });

  it("is safe to run repeatedly (skip-if-exists idempotence)", async () => {
    await ensureSeedPages(orgId);
    await ensureSeedPages(orgId);
    const pages = await testDb.page.findMany({ where: { orgId, slug: "getting-started" } });
    expect(pages).toHaveLength(1);
  });

  it("memoizes per org: a second call in-process does not re-touch the folders", async () => {
    await ensureSeedPages(orgId);
    const foldersAfterFirst = await testDb.folder.count({ where: { orgId } });
    await ensureSeedPages(orgId);
    const foldersAfterSecond = await testDb.folder.count({ where: { orgId } });
    expect(foldersAfterSecond).toBe(foldersAfterFirst);
  });

  it("seedOrgContent (org-creation path) remains callable directly and stays idempotent alongside ensureSeedPages", async () => {
    await seedOrgContent(orgId);
    await ensureSeedPages(orgId);
    const pages = await testDb.page.findMany({ where: { orgId, slug: "getting-started" } });
    expect(pages).toHaveLength(1);
  });
});

describe("read_page backfills missing seed pages before the lookup", () => {
  it("a thin-pointer skill slug that was never seeded for this org is served instead of 404ing", async () => {
    const org = await createTestOrg({ name: "Thin Pointer Org", slug: `thin-pointer-org-${Math.random().toString(36).slice(2)}` });

    const before = await testDb.page.findUnique({ where: { orgId_slug: { orgId: org.id, slug: "curata-scout-repos" } } });
    expect(before).toBeNull();

    const result = (await dispatch(
      "read_page",
      { slug: "curata-scout-repos" },
      org.id,
      org.slug,
      "apikey-1",
      "user-1"
    )) as { slug: string; yaml: string };

    expect(result.slug).toBe("curata-scout-repos");
    expect(result.yaml).toContain("Scout Repos");
  });
});
