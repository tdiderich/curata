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

describe("managed-folder seed refresh", () => {
  let orgId: string;

  beforeEach(async () => {
    const org = await createTestOrg({ name: "Refresh Org", slug: `refresh-org-${Math.random().toString(36).slice(2)}` });
    orgId = org.id;
    await seedOrgContent(orgId);
  });

  it("refreshes a managed-folder page whose latest version drifted from the shipped seed", async () => {
    const page = await testDb.page.findUnique({
      where: { orgId_slug: { orgId, slug: "architecture" } },
      include: { versions: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    expect(page).not.toBeNull();
    await testDb.pageVersion.create({
      data: { pageId: page!.id, yamlContent: "title: Stale\ncomponents: []\n", contentHash: "stale-hash", createdBy: "system" },
    });

    await seedOrgContent(orgId);

    const after = await testDb.page.findUnique({
      where: { orgId_slug: { orgId, slug: "architecture" } },
      include: { versions: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    expect(after?.versions[0].yamlContent).toContain("The knowledge loop");
  });

  it("never touches a page that was moved out of the seed folder", async () => {
    const other = await testDb.folder.create({
      data: { orgId, name: "User Folder", visibility: "org", createdBy: "human" },
    });
    const page = await testDb.page.findUnique({ where: { orgId_slug: { orgId, slug: "architecture" } } });
    await testDb.page.update({ where: { id: page!.id }, data: { folderId: other.id } });
    await testDb.pageVersion.create({
      data: { pageId: page!.id, yamlContent: "title: Mine now\ncomponents: []\n", contentHash: "mine-hash", createdBy: "human" },
    });

    await seedOrgContent(orgId);

    const after = await testDb.page.findUnique({
      where: { orgId_slug: { orgId, slug: "architecture" } },
      include: { versions: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    expect(after?.versions[0].contentHash).toBe("mine-hash");
    expect(after?.status).toBe("active");
  });

  it("archives a seeded page whose seed file no longer ships", async () => {
    const folder = await testDb.folder.findFirst({ where: { orgId, name: "Curata Managed Pages" } });
    await testDb.page.create({
      data: {
        orgId,
        slug: "self-hosting",
        title: "Self-Hosting",
        folderId: folder!.id,
        createdBy: "system",
        seeded: true,
        versions: { create: { yamlContent: "title: Self-Hosting\ncomponents: []\n", contentHash: "retired-hash", createdBy: "system" } },
      },
    });

    await seedOrgContent(orgId);

    const after = await testDb.page.findUnique({ where: { orgId_slug: { orgId, slug: "self-hosting" } } });
    expect(after?.status).toBe("archived");
  });

  it("leaves non-seeded org-custom pages in the managed folder untouched", async () => {
    const folder = await testDb.folder.findFirst({ where: { orgId, name: "Curata Managed Pages" } });
    await testDb.page.create({
      data: {
        orgId,
        slug: "legacy-doc",
        title: "Legacy Doc",
        folderId: folder!.id,
        createdBy: "web",
        versions: { create: { yamlContent: "title: Legacy Doc\ncomponents: []\n", contentHash: "legacy-hash", createdBy: "web" } },
      },
    });

    await seedOrgContent(orgId);

    const after = await testDb.page.findUnique({ where: { orgId_slug: { orgId, slug: "legacy-doc" } } });
    expect(after?.status).toBe("active");
  });

  it("archives a seeded page whose seed file was removed", async () => {
    const folder = await testDb.folder.findFirst({ where: { orgId, name: "Curata Managed Pages" } });
    await testDb.page.create({
      data: {
        orgId,
        slug: "retired-seed",
        title: "Retired Seed",
        folderId: folder!.id,
        createdBy: "system",
        seeded: true,
        versions: { create: { yamlContent: "title: Retired Seed\ncomponents: []\n", contentHash: "retired-hash", createdBy: "system" } },
      },
    });

    await seedOrgContent(orgId);

    const after = await testDb.page.findUnique({ where: { orgId_slug: { orgId, slug: "retired-seed" } } });
    expect(after?.status).toBe("archived");
  });

  it("advances a set trusted pointer on refresh and repairs a stale one without minting versions", async () => {
    const page = await testDb.page.findUnique({
      where: { orgId_slug: { orgId, slug: "architecture" } },
      include: { versions: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    // Simulate the live curata.ai state: an old trusted version, then a
    // seed refresh landed a newer latest, pointer still on the old one.
    const oldVersion = await testDb.pageVersion.create({
      data: { pageId: page!.id, yamlContent: "title: Old Trusted\ncomponents: []\n", contentHash: "old-trusted-hash", createdBy: "web" },
    });
    await testDb.page.update({ where: { id: page!.id }, data: { trustedVersionId: oldVersion.id } });

    await seedOrgContent(orgId);

    const after = await testDb.page.findUnique({
      where: { orgId_slug: { orgId, slug: "architecture" } },
      include: { versions: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    expect(after?.versions[0].yamlContent).toContain("The knowledge loop");
    expect(after?.trustedVersionId).toBe(after?.versions[0].id);

    // Second run: content matches, pointer current — no new version.
    const countBefore = await testDb.pageVersion.count({ where: { pageId: page!.id } });
    await seedOrgContent(orgId);
    const countAfter = await testDb.pageVersion.count({ where: { pageId: page!.id } });
    expect(countAfter).toBe(countBefore);
  });

  it("keeps never-trusted seed pages never-trusted through a refresh", async () => {
    const page = await testDb.page.findUnique({ where: { orgId_slug: { orgId, slug: "connecting-your-agent" } } });
    expect(page?.trustedVersionId).toBeNull();
    await testDb.pageVersion.create({
      data: { pageId: page!.id, yamlContent: "title: Drift\ncomponents: []\n", contentHash: "drift-hash", createdBy: "system" },
    });

    await seedOrgContent(orgId);

    const after = await testDb.page.findUnique({ where: { orgId_slug: { orgId, slug: "connecting-your-agent" } } });
    expect(after?.trustedVersionId).toBeNull();
  });

  it("preserves the getting-started page from the retired sweep and reactivates archived seed pages", async () => {
    const gs = await testDb.page.findUnique({ where: { orgId_slug: { orgId, slug: "getting-started" } } });
    expect(gs).not.toBeNull();

    const arch = await testDb.page.findUnique({ where: { orgId_slug: { orgId, slug: "architecture" } } });
    await testDb.page.update({ where: { id: arch!.id }, data: { status: "archived" } });
    const versionsBefore = await testDb.pageVersion.count({ where: { pageId: arch!.id } });

    await seedOrgContent(orgId);

    const gsAfter = await testDb.page.findUnique({ where: { orgId_slug: { orgId, slug: "getting-started" } } });
    expect(gsAfter?.status).toBe("active");
    const archAfter = await testDb.page.findUnique({ where: { orgId_slug: { orgId, slug: "architecture" } } });
    expect(archAfter?.status).toBe("active");
    // Content already matched the seed, so reactivation must not mint a new version.
    const versionsAfter = await testDb.pageVersion.count({ where: { pageId: arch!.id } });
    expect(versionsAfter).toBe(versionsBefore);
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
