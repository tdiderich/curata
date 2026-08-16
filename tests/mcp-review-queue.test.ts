import { describe, it, expect, vi, beforeEach } from "vitest";
import { testDb } from "./setup";
import { createTestOrg, createTestPage } from "./helpers";

// Mock db to use test database
vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});

// No filesystem/browser side effects from tools unrelated to this file.
vi.mock("@/lib/kazam", async () => {
  const os = await import("os");
  const path = await import("path");
  const tmpDir = path.join(os.tmpdir(), `curata-test-mcp-review-queue-${process.pid}`);
  return {
    sitePath: () => tmpDir,
    buildSite: vi.fn().mockResolvedValue(""),
    validateContent: vi.fn().mockResolvedValue([]),
    checkUnsupportedComponents: vi.fn().mockReturnValue([]),
  };
});

import { dispatch } from "@/lib/mcp-dispatch";

interface ReviewQueueToolRow {
  slug: string;
  title: string;
  folderName: string | null;
  neverTrusted: boolean;
  versionsBehind: number;
  trustedVersionId: string | null;
  latestVersionId: string | null;
  approvalRule: string | null;
}

describe("MCP dispatch — get_review_queue", () => {
  let orgId: string;
  let orgSlug: string;

  beforeEach(async () => {
    const org = await createTestOrg({ name: "Review Queue Org", slug: "review-queue-org" });
    orgId = org.id;
    orgSlug = org.slug;
  });

  it("excludes a never-trusted page when no approval rule governs its scope", async () => {
    await createTestPage(orgId, { slug: "unruled-page" });

    const rows = (await dispatch("get_review_queue", {}, orgId, orgSlug, "apikey-1")) as ReviewQueueToolRow[];
    expect(rows.find((r) => r.slug === "unruled-page")).toBeUndefined();
  });

  it("includes a never-trusted page inside a folder with an approval rule, with an approval rule description", async () => {
    const folder = await testDb.folder.create({
      data: {
        orgId,
        name: "Gated Folder",
        createdBy: "test-user",
        rules: [{ id: "approval", kind: "approval", approvers: [{ type: "user", id: "alice" }] }],
      },
    });
    const page = await createTestPage(orgId, { slug: "gated-never-trusted", folderId: folder.id });

    const rows = (await dispatch("get_review_queue", {}, orgId, orgSlug, "apikey-1")) as ReviewQueueToolRow[];
    const entry = rows.find((r) => r.slug === "gated-never-trusted");
    expect(entry).toBeDefined();
    expect(entry!.neverTrusted).toBe(true);
    expect(entry!.folderName).toBe("Gated Folder");
    expect(entry!.approvalRule).toMatch(/approval limited to: alice/);
    expect(entry!.latestVersionId).toBe(page.versions[0].id);
    expect(entry!.trustedVersionId).toBeNull();
  });

  it("includes a trustedBehind page regardless of approval rules, with both version ids populated", async () => {
    const page = await createTestPage(orgId, {
      slug: "behind-page",
      yamlContent: "title: V1\nshell: document\ncomponents: []\n",
    });
    const v1Id = page.versions[0].id;
    await testDb.page.update({ where: { id: page.id }, data: { trustedVersionId: v1Id } });
    const v2 = await testDb.pageVersion.create({
      data: { pageId: page.id, yamlContent: "title: V2\nshell: document\ncomponents: []\n", contentHash: "hash-v2", createdBy: "user1" },
    });

    const rows = (await dispatch("get_review_queue", {}, orgId, orgSlug, "apikey-1")) as ReviewQueueToolRow[];
    const entry = rows.find((r) => r.slug === "behind-page");
    expect(entry).toBeDefined();
    expect(entry!.neverTrusted).toBe(false);
    expect(entry!.versionsBehind).toBe(1);
    expect(entry!.trustedVersionId).toBe(v1Id);
    expect(entry!.latestVersionId).toBe(v2.id);
    expect(entry!.approvalRule).toBeNull();
  });

  it("excludes a locked-folder page unconditionally, even under a global approval rule", async () => {
    await testDb.organization.update({
      where: { id: orgId },
      data: { rules: [{ id: "approval", kind: "approval", approvers: [{ type: "group", id: "g1" }] }] },
    });
    const lockedFolder = await testDb.folder.create({
      data: { orgId, name: "Templates", createdBy: "system", locked: true },
    });
    await createTestPage(orgId, { slug: "locked-never-trusted", folderId: lockedFolder.id });

    const rows = (await dispatch("get_review_queue", {}, orgId, orgSlug, "apikey-1")) as ReviewQueueToolRow[];
    expect(rows.find((r) => r.slug === "locked-never-trusted")).toBeUndefined();
  });

  it("returns an empty array when nothing needs review", async () => {
    const rows = (await dispatch("get_review_queue", {}, orgId, orgSlug, "apikey-1")) as ReviewQueueToolRow[];
    expect(rows).toEqual([]);
  });

  it("rejects an unknown parameter with a teaching error naming the valid list", async () => {
    await expect(
      dispatch("get_review_queue", { status: "pending" }, orgId, orgSlug, "apikey-1")
    ).rejects.toThrow(/unknown parameter for get_review_queue: "status"\. Valid:/);
  });
});

describe("MCP dispatch — annotate_page pre-screen provenance", () => {
  let orgId: string;
  let orgSlug: string;

  beforeEach(async () => {
    const org = await createTestOrg({ name: "Prescreen Org", slug: "prescreen-org" });
    orgId = org.id;
    orgSlug = org.slug;
  });

  it("defaults to source \"agent\" when no source is passed", async () => {
    await createTestPage(orgId, { slug: "annotated-page" });
    await dispatch(
      "annotate_page",
      { slug: "annotated-page", text: "a normal note" },
      orgId,
      orgSlug,
      "apikey-1"
    );
    const ann = await testDb.annotation.findFirst({ where: { text: "a normal note" } });
    expect(ann?.source).toBe("agent");
  });

  it("records source \"prescreen\" when passed by a review pre-screen finding", async () => {
    await createTestPage(orgId, { slug: "screened-page" });
    await dispatch(
      "annotate_page",
      { slug: "screened-page", text: "likely duplicate of some-other-slug", kind: "note", source: "prescreen" },
      orgId,
      orgSlug,
      "apikey-1"
    );
    const ann = await testDb.annotation.findFirst({ where: { text: "likely duplicate of some-other-slug" } });
    expect(ann?.source).toBe("prescreen");
    expect(ann?.kind).toBe("note");
  });

  it("rejects an invalid source value with a teaching error", async () => {
    await createTestPage(orgId, { slug: "bad-source-page" });
    await expect(
      dispatch(
        "annotate_page",
        { slug: "bad-source-page", text: "note", source: "made-up" },
        orgId,
        orgSlug,
        "apikey-1"
      )
    ).rejects.toThrow(/source must be "agent" or "prescreen"/);
  });
});
