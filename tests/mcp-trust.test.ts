import { describe, it, expect, vi, beforeEach } from "vitest";
import { testDb } from "./setup";
import { createTestOrg, createTestPage } from "./helpers";

// Mock db to use test database
vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});

// No filesystem/browser side effects from tools unrelated to trust.
vi.mock("@/lib/kazam", async () => {
  const os = await import("os");
  const path = await import("path");
  const tmpDir = path.join(os.tmpdir(), `curata-test-mcp-trust-${process.pid}`);
  return {
    sitePath: () => tmpDir,
    buildSite: vi.fn().mockResolvedValue(""),
    validateContent: vi.fn().mockResolvedValue([]),
    checkUnsupportedComponents: vi.fn().mockReturnValue([]),
  };
});

import { dispatch } from "@/lib/mcp-dispatch";

describe("MCP dispatch — mark_trusted / clear_trusted", () => {
  let orgId: string;
  let orgSlug: string;

  beforeEach(async () => {
    const org = await createTestOrg({ name: "MCP Trust Org", slug: "mcp-trust-org" });
    orgId = org.id;
    orgSlug = org.slug;
  });

  it("flips the trusted pointer to the latest version by default and audits the write", async () => {
    await testDb.orgMember.create({ data: { orgId, userId: "owner-1", role: "owner" } });
    const page = await createTestPage(orgId, { slug: "gated-page" });
    const versionId = page.versions[0].id;

    const result = (await dispatch(
      "mark_trusted",
      { slug: "gated-page" },
      orgId,
      orgSlug,
      "apikey-1",
      "owner-1"
    )) as { ok: boolean; slug: string; versionId: string };

    expect(result.ok).toBe(true);
    expect(result.versionId).toBe(versionId);

    const updated = await testDb.page.findUnique({ where: { orgId_slug: { orgId, slug: "gated-page" } } });
    expect(updated?.trustedVersionId).toBe(versionId);

    const audit = await testDb.auditLog.findFirst({ where: { orgId, action: "page.trust", resourceId: "gated-page" } });
    expect(audit).toBeTruthy();
    expect(audit?.actorId).toBe("owner-1");
  });

  it("accepts an explicit version_id", async () => {
    await testDb.orgMember.create({ data: { orgId, userId: "owner-1", role: "owner" } });
    const page = await createTestPage(orgId, { slug: "gated-page" });
    const firstVersionId = page.versions[0].id;

    // second version becomes "latest"
    await testDb.pageVersion.create({
      data: { pageId: page.id, yamlContent: "title: v2\nshell: document\ncomponents: []\n", contentHash: "hash2", createdBy: "owner-1" },
    });

    const result = (await dispatch(
      "mark_trusted",
      { slug: "gated-page", version_id: firstVersionId },
      orgId,
      orgSlug,
      "apikey-1",
      "owner-1"
    )) as { ok: boolean; versionId: string };

    expect(result.ok).toBe(true);
    expect(result.versionId).toBe(firstVersionId);

    const updated = await testDb.page.findUnique({ where: { orgId_slug: { orgId, slug: "gated-page" } } });
    expect(updated?.trustedVersionId).toBe(firstVersionId);
  });

  it("rejects an ineligible caller with an error naming the approval rule", async () => {
    const group = await testDb.group.create({ data: { orgId, name: "Test", slug: "test" } });
    await createTestPage(orgId, {
      slug: "gated-page",
      rules: [{ id: "approval", kind: "approval", approvers: [{ type: "group", id: group.id }] }],
    });
    await testDb.orgMember.create({ data: { orgId, userId: "outsider", role: "member" } });

    await expect(
      dispatch("mark_trusted", { slug: "gated-page" }, orgId, orgSlug, "apikey-1", "outsider")
    ).rejects.toThrow(/forbidden: approval limited to: Test/);

    const untouched = await testDb.page.findUnique({ where: { orgId_slug: { orgId, slug: "gated-page" } } });
    expect(untouched?.trustedVersionId).toBeNull();
  });

  it("allows a member who is in the approval rule's group", async () => {
    const group = await testDb.group.create({ data: { orgId, name: "Test", slug: "test" } });
    const page = await createTestPage(orgId, {
      slug: "gated-page",
      rules: [{ id: "approval", kind: "approval", approvers: [{ type: "group", id: group.id }] }],
    });
    await testDb.orgMember.create({ data: { orgId, userId: "insider", role: "member" } });
    await testDb.groupMember.create({ data: { groupId: group.id, userId: "insider", role: "member" } });

    const result = (await dispatch(
      "mark_trusted",
      { slug: "gated-page" },
      orgId,
      orgSlug,
      "apikey-1",
      "insider"
    )) as { ok: boolean };
    expect(result.ok).toBe(true);

    const updated = await testDb.page.findUnique({ where: { orgId_slug: { orgId, slug: "gated-page" } } });
    expect(updated?.trustedVersionId).toBe(page.versions[0].id);
  });

  it("org owners bypass the approval rule (escape hatch)", async () => {
    const group = await testDb.group.create({ data: { orgId, name: "Test", slug: "test" } });
    await createTestPage(orgId, {
      slug: "gated-page",
      rules: [{ id: "approval", kind: "approval", approvers: [{ type: "group", id: group.id }] }],
    });
    await testDb.orgMember.create({ data: { orgId, userId: "the-owner", role: "owner" } });

    const result = (await dispatch(
      "mark_trusted",
      { slug: "gated-page" },
      orgId,
      orgSlug,
      "apikey-1",
      "the-owner"
    )) as { ok: boolean };
    expect(result.ok).toBe(true);
  });

  it("clear_trusted clears the pointer and is audited, gated the same way", async () => {
    await testDb.orgMember.create({ data: { orgId, userId: "owner-1", role: "owner" } });
    const page = await createTestPage(orgId, { slug: "gated-page" });
    await testDb.page.update({ where: { id: page.id }, data: { trustedVersionId: page.versions[0].id } });

    const result = (await dispatch(
      "clear_trusted",
      { slug: "gated-page" },
      orgId,
      orgSlug,
      "apikey-1",
      "owner-1"
    )) as { ok: boolean };
    expect(result.ok).toBe(true);

    const updated = await testDb.page.findUnique({ where: { orgId_slug: { orgId, slug: "gated-page" } } });
    expect(updated?.trustedVersionId).toBeNull();

    const audit = await testDb.auditLog.findFirst({ where: { orgId, action: "page.untrust", resourceId: "gated-page" } });
    expect(audit).toBeTruthy();
  });

  it("clear_trusted rejects an ineligible caller", async () => {
    const group = await testDb.group.create({ data: { orgId, name: "Test", slug: "test" } });
    const page = await createTestPage(orgId, {
      slug: "gated-page",
      rules: [{ id: "approval", kind: "approval", approvers: [{ type: "group", id: group.id }] }],
    });
    await testDb.page.update({ where: { id: page.id }, data: { trustedVersionId: page.versions[0].id } });
    await testDb.orgMember.create({ data: { orgId, userId: "outsider", role: "member" } });

    await expect(
      dispatch("clear_trusted", { slug: "gated-page" }, orgId, orgSlug, "apikey-1", "outsider")
    ).rejects.toThrow(/forbidden: approval limited to: Test/);
  });

  it("mark_trusted 404s a page that does not exist", async () => {
    await testDb.orgMember.create({ data: { orgId, userId: "owner-1", role: "owner" } });
    await expect(
      dispatch("mark_trusted", { slug: "no-such-page" }, orgId, orgSlug, "apikey-1", "owner-1")
    ).rejects.toThrow(/page not found/);
  });
});
