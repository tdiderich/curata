import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { testDb } from "./setup";
import { createTestOrg, createTestPage } from "./helpers";

let tmpDir: string;

// Mock db to use test database
vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});

vi.mock("@/lib/kazam", () => {
  return {
    sitePath: (orgSlug: string) => path.join(tmpDir, orgSlug),
    validatePage: vi.fn().mockResolvedValue([]),
    validateContent: vi.fn().mockResolvedValue([]),
  };
});

import { syncPage, syncAndBuild } from "@/lib/sync";

describe("sync", () => {
  let orgId: string;
  let orgSlug: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "curata-sync-test-"));
  });

  beforeEach(async () => {
    const org = await createTestOrg({ name: "Sync Test Org", slug: "sync-test-org" });
    orgId = org.id;
    orgSlug = org.slug;
  });

  it("syncPage writes YAML file to disk", async () => {
    const page = await createTestPage(orgId, { slug: "sync-write", orgId });
    await syncPage(orgSlug, page.id);

    const filePath = path.join(tmpDir, orgSlug, "sync-write.yaml");
    const content = await fs.readFile(filePath, "utf-8");
    expect(content).toContain("title: Test");
  });

  it("syncPage creates kazam.yaml if missing", async () => {
    // Use a fresh org to get a clean directory
    const org2 = await createTestOrg({
      name: "Config New Org",
      slug: "config-new-org",
    });
    const page2 = await createTestPage(org2.id, { slug: "sync-config-new", orgId: org2.id });

    await syncPage(org2.slug, page2.id);

    const configPath = path.join(tmpDir, org2.slug, "kazam.yaml");
    const config = await fs.readFile(configPath, "utf-8");
    expect(config).toContain("name:");
  });

  it("syncPage rewrites kazam.yaml when it lacks name: field", async () => {
    const org3 = await createTestOrg({
      name: "Rewrite Org",
      slug: "rewrite-org",
    });
    const page3 = await createTestPage(org3.id, { slug: "page-rw", orgId: org3.id });

    const siteDir = path.join(tmpDir, org3.slug);
    await fs.mkdir(siteDir, { recursive: true });
    // Write a kazam.yaml without "name:"
    await fs.writeFile(path.join(siteDir, "kazam.yaml"), "theme: default\n");

    await syncPage(org3.slug, page3.id);

    const config = await fs.readFile(path.join(siteDir, "kazam.yaml"), "utf-8");
    expect(config).toContain("name:");
  });

  it("syncPage writes annotation files", async () => {
    const page = await createTestPage(orgId, { slug: "sync-ann", orgId });
    await testDb.annotation.create({
      data: {
        pageId: page.id,
        text: "Nice work",
        author: "reviewer",
        kind: "note",
        status: "pending",
        source: "web",
      },
    });

    await syncPage(orgSlug, page.id);

    const annDir = path.join(tmpDir, orgSlug, ".kazam", "annotations", "sync-ann");
    const files = await fs.readdir(annDir);
    expect(files.length).toBe(1);
    const annContent = await fs.readFile(path.join(annDir, files[0]), "utf-8");
    expect(annContent).toContain("Nice work");
  });

  it("syncPage updates syncStatus to synced", async () => {
    const page = await createTestPage(orgId, { slug: "sync-status", orgId });
    await syncPage(orgSlug, page.id);

    const updated = await testDb.page.findUnique({ where: { id: page.id } });
    expect(updated!.syncStatus).toBe("synced");
    expect(updated!.syncedAt).not.toBeNull();
  });

  it("syncAndBuild handles errors gracefully", async () => {
    const page = await createTestPage(orgId, { slug: "err-page", orgId });
    // Delete the page from DB so syncPage will short-circuit gracefully
    await testDb.page.delete({ where: { id: page.id } });

    // Should not throw
    await expect(syncAndBuild(orgSlug, page.id)).resolves.toBeUndefined();
  });
});
