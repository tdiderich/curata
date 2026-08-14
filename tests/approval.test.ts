import { describe, it, expect, vi, beforeEach } from "vitest";
import { testDb } from "./setup";
import { createTestOrg, createTestPage } from "./helpers";

// Mock db to use test database
vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});

import {
  parseApprovalRules,
  validateApprovalRule,
  resolveEffectiveApprovalRule,
  getApprovers,
  describeApprovalRule,
  canApprove,
  canApproveBatch,
} from "@/lib/approval";

describe("parseApprovalRules", () => {
  it("extracts approval-kind entries and ignores content rules mixed in the same array", () => {
    const json = [
      { id: "no-emdash", text: "Never use em dashes.", mode: "block" },
      { id: "approval", kind: "approval", approvers: [{ type: "group", id: "g1" }] },
    ];
    const rules = parseApprovalRules(json);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ id: "approval", kind: "approval", approvers: [{ type: "group", id: "g1" }] });
  });

  it("drops malformed approver entries", () => {
    const json = [{ id: "approval", kind: "approval", approvers: [{ type: "bogus", id: "x" }] }];
    expect(parseApprovalRules(json)).toHaveLength(0);
  });

  it("returns an empty array for null/non-array input", () => {
    expect(parseApprovalRules(null)).toEqual([]);
    expect(parseApprovalRules("nonsense")).toEqual([]);
  });
});

describe("validateApprovalRule", () => {
  it("accepts a well-formed approver list", () => {
    const result = validateApprovalRule({ approvers: [{ type: "user", id: "u1" }] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rule.id).toBe("approval");
  });

  it("rejects an empty approvers array", () => {
    const result = validateApprovalRule({ approvers: [] });
    expect(result.ok).toBe(false);
  });

  it("rejects a malformed approver entry", () => {
    const result = validateApprovalRule({ approvers: [{ type: "group" }] });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-object candidate", () => {
    expect(validateApprovalRule(null).ok).toBe(false);
    expect(validateApprovalRule("nope").ok).toBe(false);
  });
});

describe("resolveEffectiveApprovalRule cascade", () => {
  let orgId: string;

  beforeEach(async () => {
    const org = await createTestOrg({ name: "Approval Cascade Org", slug: "approval-cascade-org" });
    orgId = org.id;
  });

  it("returns null when no scope defines a rule", async () => {
    expect(await resolveEffectiveApprovalRule(orgId, null, null)).toBeNull();
  });

  it("falls back to the global rule when no folder/page rule exists", async () => {
    await testDb.organization.update({
      where: { id: orgId },
      data: { rules: [{ id: "approval", kind: "approval", approvers: [{ type: "group", id: "g1" }] }] },
    });
    const resolved = await resolveEffectiveApprovalRule(orgId, null, null);
    expect(resolved?.scope).toBe("global");
  });

  it("a folder rule overrides the global rule", async () => {
    await testDb.organization.update({
      where: { id: orgId },
      data: { rules: [{ id: "approval", kind: "approval", approvers: [{ type: "group", id: "global-group" }] }] },
    });
    const folder = await testDb.folder.create({
      data: {
        orgId,
        name: "Docs",
        createdBy: "test-user",
        rules: [{ id: "approval", kind: "approval", approvers: [{ type: "group", id: "folder-group" }] }],
      },
    });
    const resolved = await resolveEffectiveApprovalRule(orgId, folder.id, null);
    expect(resolved?.scope).toBe(`folder:${folder.name}`);
    expect(resolved?.rule.approvers[0].id).toBe("folder-group");
  });

  it("a page rule overrides both folder and global", async () => {
    const folder = await testDb.folder.create({
      data: {
        orgId,
        name: "Docs",
        createdBy: "test-user",
        rules: [{ id: "approval", kind: "approval", approvers: [{ type: "group", id: "folder-group" }] }],
      },
    });
    const pageRulesJson = [{ id: "approval", kind: "approval", approvers: [{ type: "user", id: "page-user" }] }];
    const resolved = await resolveEffectiveApprovalRule(orgId, folder.id, pageRulesJson);
    expect(resolved?.scope).toBe("page");
    expect(resolved?.rule.approvers[0]).toMatchObject({ type: "user", id: "page-user" });
  });

  it("walks up through nested folders to find the nearest ancestor with a rule", async () => {
    const parent = await testDb.folder.create({
      data: {
        orgId,
        name: "Parent",
        createdBy: "test-user",
        rules: [{ id: "approval", kind: "approval", approvers: [{ type: "group", id: "parent-group" }] }],
      },
    });
    const child = await testDb.folder.create({
      data: { orgId, name: "Child", parentId: parent.id, createdBy: "test-user" },
    });
    const resolved = await resolveEffectiveApprovalRule(orgId, child.id, null);
    expect(resolved?.scope).toBe(`folder:${parent.name}`);
  });
});

describe("getApprovers / describeApprovalRule", () => {
  let orgId: string;

  beforeEach(async () => {
    const org = await createTestOrg({ name: "Describe Org", slug: "describe-org" });
    orgId = org.id;
  });

  it("returns null for a page with no approval rule anywhere", async () => {
    await createTestPage(orgId, { slug: "no-rule-page" });
    expect(await getApprovers(orgId, "no-rule-page")).toBeNull();
  });

  it("resolves group names in the muted-note description", async () => {
    const group = await testDb.group.create({ data: { orgId, name: "Test", slug: "test" } });
    await createTestPage(orgId, {
      slug: "gated-page",
      rules: [{ id: "approval", kind: "approval", approvers: [{ type: "group", id: group.id }] }],
    });
    const resolved = await getApprovers(orgId, "gated-page");
    expect(resolved).not.toBeNull();
    const note = await describeApprovalRule(orgId, resolved!.rule);
    expect(note).toBe("approval limited to: Test");
  });
});

describe("canApprove", () => {
  let orgId: string;
  let group: { id: string };

  beforeEach(async () => {
    const org = await createTestOrg({ name: "Eligibility Org", slug: "eligibility-org" });
    orgId = org.id;
    group = await testDb.group.create({ data: { orgId, name: "Test", slug: "test" } });
  });

  it("is eligible when no rule governs the page", async () => {
    await createTestPage(orgId, { slug: "open-page" });
    expect(await canApprove(orgId, "someone", "member", "open-page")).toBe(true);
  });

  it("is eligible when directly listed as a user approver", async () => {
    await createTestPage(orgId, {
      slug: "listed-page",
      rules: [{ id: "approval", kind: "approval", approvers: [{ type: "user", id: "alice" }] }],
    });
    expect(await canApprove(orgId, "alice", "member", "listed-page")).toBe(true);
    expect(await canApprove(orgId, "bob", "member", "listed-page")).toBe(false);
  });

  it("is eligible via group membership", async () => {
    await testDb.orgMember.create({ data: { orgId, userId: "carol", role: "member" } });
    await testDb.groupMember.create({ data: { groupId: group.id, userId: "carol", role: "member" } });
    await createTestPage(orgId, {
      slug: "group-page",
      rules: [{ id: "approval", kind: "approval", approvers: [{ type: "group", id: group.id }] }],
    });
    expect(await canApprove(orgId, "carol", "member", "group-page")).toBe(true);
  });

  it("is ineligible for a non-member with a group-restricted rule", async () => {
    await createTestPage(orgId, {
      slug: "group-page-2",
      rules: [{ id: "approval", kind: "approval", approvers: [{ type: "group", id: group.id }] }],
    });
    expect(await canApprove(orgId, "dave", "member", "group-page-2")).toBe(false);
  });

  it("org owners and admins are always eligible, even when not listed", async () => {
    await createTestPage(orgId, {
      slug: "restricted-page",
      rules: [{ id: "approval", kind: "approval", approvers: [{ type: "user", id: "alice" }] }],
    });
    expect(await canApprove(orgId, "someone-else", "owner", "restricted-page")).toBe(true);
    expect(await canApprove(orgId, "someone-else", "admin", "restricted-page")).toBe(true);
    expect(await canApprove(orgId, "someone-else", "member", "restricted-page")).toBe(false);
  });
});

describe("canApproveBatch", () => {
  let orgId: string;
  let group: { id: string };

  beforeEach(async () => {
    const org = await createTestOrg({ name: "Batch Org", slug: "batch-org" });
    orgId = org.id;
    group = await testDb.group.create({ data: { orgId, name: "Test", slug: "test" } });
    await testDb.orgMember.create({ data: { orgId, userId: "carol", role: "member" } });
    await testDb.groupMember.create({ data: { groupId: group.id, userId: "carol", role: "member" } });
  });

  it("matches canApprove per-slug across a mix of open, group-gated, and user-gated pages", async () => {
    await createTestPage(orgId, { slug: "batch-open" });
    await createTestPage(orgId, {
      slug: "batch-group",
      rules: [{ id: "approval", kind: "approval", approvers: [{ type: "group", id: group.id }] }],
    });
    await createTestPage(orgId, {
      slug: "batch-user",
      rules: [{ id: "approval", kind: "approval", approvers: [{ type: "user", id: "zoe" }] }],
    });

    const slugs = ["batch-open", "batch-group", "batch-user"];
    const batch = await canApproveBatch(orgId, "carol", "member", slugs);

    for (const slug of slugs) {
      expect(batch.get(slug)!.eligible).toBe(await canApprove(orgId, "carol", "member", slug));
    }
    expect(batch.get("batch-open")!.eligible).toBe(true);
    expect(batch.get("batch-group")!.eligible).toBe(true);
    expect(batch.get("batch-user")!.eligible).toBe(false);
    expect(batch.get("batch-user")!.restrictionNote).toBe("approval limited to: zoe");
    expect(batch.get("batch-open")!.restrictionNote).toBeNull();
  });

  it("returns an empty map for an empty slug list", async () => {
    expect((await canApproveBatch(orgId, "carol", "member", [])).size).toBe(0);
  });

  it("admins are eligible for every gated row without a group-membership lookup", async () => {
    await createTestPage(orgId, {
      slug: "admin-gated",
      rules: [{ id: "approval", kind: "approval", approvers: [{ type: "user", id: "someone-else" }] }],
    });
    const batch = await canApproveBatch(orgId, "the-admin", "owner", ["admin-gated"]);
    expect(batch.get("admin-gated")!.eligible).toBe(true);
  });
});
