import { describe, it, expect, vi, beforeEach } from "vitest";
import { testDb } from "./setup";
import { createTestOrg } from "./helpers";

// Mock db to use test database
vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});

// No filesystem/browser side effects from tools unrelated to groups.
vi.mock("@/lib/kazam", async () => {
  const os = await import("os");
  const path = await import("path");
  const tmpDir = path.join(os.tmpdir(), `curata-test-groups-${process.pid}`);
  return {
    sitePath: () => tmpDir,
    buildSite: vi.fn().mockResolvedValue(""),
    validateContent: vi.fn().mockResolvedValue([]),
    checkUnsupportedComponents: vi.fn().mockReturnValue([]),
  };
});

import {
  createGroup,
  renameGroup,
  deleteGroup,
  listGroupsWithMembers,
  addGroupMembers,
  removeGroupMember,
  setGroupMemberRole,
  isOrgManager,
  assertGroupManager,
  slugifyGroupName,
} from "@/lib/groups";
import { dispatch } from "@/lib/mcp-dispatch";

describe("groups library", () => {
  let orgId: string;

  beforeEach(async () => {
    const org = await createTestOrg({ name: "Groups Test Org", slug: "groups-test-org" });
    orgId = org.id;
  });

  describe("slugifyGroupName", () => {
    it("normalizes a name to a lowercase-hyphen slug", () => {
      expect(slugifyGroupName("Customer Success!!")).toBe("customer-success");
      expect(slugifyGroupName("  Sales  ")).toBe("sales");
    });

    it("falls back to a placeholder slug when nothing normalizable remains", () => {
      expect(slugifyGroupName("!!!")).toBe("group");
    });
  });

  describe("createGroup", () => {
    it("creates a group with a normalized slug", async () => {
      const group = await createGroup(orgId, "Customer Success");
      expect(group.name).toBe("Customer Success");
      expect(group.slug).toBe("customer-success");
      expect(group.orgId).toBe(orgId);
    });

    it("rejects a duplicate name (same normalized slug) within the org", async () => {
      await createGroup(orgId, "Sales");
      await expect(createGroup(orgId, "sales")).rejects.toThrow(/already exists/);
    });

    it("rejects an empty name", async () => {
      await expect(createGroup(orgId, "   ")).rejects.toThrow("name is required");
    });

    it("allows the same slug in a different org", async () => {
      const otherOrg = await createTestOrg({ name: "Other Org", slug: "other-org" });
      await createGroup(orgId, "Sales");
      await expect(createGroup(otherOrg.id, "Sales")).resolves.toMatchObject({ slug: "sales" });
    });
  });

  describe("renameGroup", () => {
    it("renames a group and updates its slug", async () => {
      const group = await createGroup(orgId, "Sales");
      const renamed = await renameGroup(orgId, group.id, "Revenue");
      expect(renamed.name).toBe("Revenue");
      expect(renamed.slug).toBe("revenue");
    });

    it("rejects renaming to a name that collides with another group", async () => {
      await createGroup(orgId, "Sales");
      const group2 = await createGroup(orgId, "Marketing");
      await expect(renameGroup(orgId, group2.id, "Sales")).rejects.toThrow(/already exists/);
    });

    it("throws for a group not found in this org", async () => {
      await expect(renameGroup(orgId, "missing-id", "New Name")).rejects.toThrow("group not found");
    });
  });

  describe("deleteGroup", () => {
    it("deletes a group and cascades its memberships", async () => {
      const group = await createGroup(orgId, "Sales");
      await testDb.orgMember.create({ data: { orgId, userId: "user-1", role: "member" } });
      await addGroupMembers(orgId, group.id, ["user-1"]);

      await deleteGroup(orgId, group.id);

      const found = await testDb.group.findUnique({ where: { id: group.id } });
      expect(found).toBeNull();
      const members = await testDb.groupMember.findMany({ where: { groupId: group.id } });
      expect(members).toHaveLength(0);
    });

    it("throws for a group not found in this org", async () => {
      await expect(deleteGroup(orgId, "missing-id")).rejects.toThrow("group not found");
    });
  });

  describe("membership ops", () => {
    it("bulk-adds multiple valid org members, skipping duplicates and invalid ids", async () => {
      const group = await createGroup(orgId, "Sales");
      await testDb.orgMember.createMany({
        data: [
          { orgId, userId: "user-1", role: "member" },
          { orgId, userId: "user-2", role: "member" },
        ],
      });
      // user-1 is already in the group before the bulk call
      await addGroupMembers(orgId, group.id, ["user-1"]);

      const result = await addGroupMembers(orgId, group.id, ["user-1", "user-2", "not-a-member"]);

      expect(result.added).toEqual(["user-2"]);
      expect(result.alreadyMember).toEqual(["user-1"]);
      expect(result.invalid).toEqual(["not-a-member"]);

      const withMembers = await listGroupsWithMembers(orgId);
      const sales = withMembers.find((g) => g.id === group.id)!;
      expect(sales.memberCount).toBe(2);
      expect(new Set(sales.members.map((m) => m.userId))).toEqual(new Set(["user-1", "user-2"]));
    });

    it("removes a member from a group", async () => {
      const group = await createGroup(orgId, "Sales");
      await testDb.orgMember.create({ data: { orgId, userId: "user-1", role: "member" } });
      await addGroupMembers(orgId, group.id, ["user-1"]);

      await removeGroupMember(orgId, group.id, "user-1");

      const groups = await listGroupsWithMembers(orgId);
      expect(groups.find((g) => g.id === group.id)!.members).toHaveLength(0);
    });

    it("transfers the group-level owner role", async () => {
      const group = await createGroup(orgId, "Sales");
      await testDb.orgMember.create({ data: { orgId, userId: "user-1", role: "member" } });
      await addGroupMembers(orgId, group.id, ["user-1"]);

      await setGroupMemberRole(orgId, group.id, "user-1", "owner");

      const groups = await listGroupsWithMembers(orgId);
      expect(groups.find((g) => g.id === group.id)!.members[0]).toMatchObject({
        userId: "user-1",
        role: "owner",
      });
    });

    it("throws when setting a role for a non-member", async () => {
      const group = await createGroup(orgId, "Sales");
      await expect(setGroupMemberRole(orgId, group.id, "ghost", "owner")).rejects.toThrow(
        "user is not a member of this group"
      );
    });
  });

  describe("isOrgManager / assertGroupManager", () => {
    it("treats org owners and admins as managers", async () => {
      await testDb.orgMember.create({ data: { orgId, userId: "owner-1", role: "owner" } });
      await testDb.orgMember.create({ data: { orgId, userId: "admin-1", role: "admin" } });
      expect(await isOrgManager(orgId, "owner-1")).toBe(true);
      expect(await isOrgManager(orgId, "admin-1")).toBe(true);
    });

    it("rejects members and viewers", async () => {
      await testDb.orgMember.create({ data: { orgId, userId: "member-1", role: "member" } });
      await testDb.orgMember.create({ data: { orgId, userId: "viewer-1", role: "viewer" } });
      expect(await isOrgManager(orgId, "member-1")).toBe(false);
      expect(await isOrgManager(orgId, "viewer-1")).toBe(false);
    });

    it("treats system/web/migration keys as managers, matching resolveOrgFromApiKey", async () => {
      expect(await isOrgManager(orgId, "system")).toBe(true);
      expect(await isOrgManager(orgId, "web")).toBe(true);
      expect(await isOrgManager(orgId, "migration")).toBe(true);
    });

    it("assertGroupManager throws a descriptive error for non-managers", async () => {
      await testDb.orgMember.create({ data: { orgId, userId: "member-1", role: "member" } });
      await expect(assertGroupManager(orgId, "member-1", "create groups")).rejects.toThrow(
        "only org owners/admins can create groups"
      );
    });
  });
});

describe("MCP dispatch — group tools", () => {
  let orgId: string;
  let orgSlug: string;

  beforeEach(async () => {
    const org = await createTestOrg({ name: "Dispatch Groups Org", slug: "dispatch-groups-org" });
    orgId = org.id;
    orgSlug = org.slug;
    await testDb.orgMember.create({ data: { orgId, userId: "owner-1", role: "owner" } });
    await testDb.orgMember.create({ data: { orgId, userId: "member-1", role: "member" } });
  });

  it("list_groups is readable by anyone (no manager gate)", async () => {
    await dispatch("create_group", { name: "Sales" }, orgId, orgSlug, "apikey-1", "owner-1");
    const result = (await dispatch("list_groups", {}, orgId, orgSlug, "apikey-1", "member-1")) as unknown[];
    expect(result).toHaveLength(1);
  });

  it("create_group succeeds for an org owner", async () => {
    const result = (await dispatch("create_group", { name: "Sales" }, orgId, orgSlug, "apikey-1", "owner-1")) as {
      ok: boolean;
      name: string;
    };
    expect(result.ok).toBe(true);
    expect(result.name).toBe("Sales");
  });

  it("create_group is rejected for a non-owner/admin actor", async () => {
    await expect(
      dispatch("create_group", { name: "Sales" }, orgId, orgSlug, "apikey-1", "member-1")
    ).rejects.toThrow("only org owners/admins can create groups");
  });

  it("update_group, delete_group, add_group_member, remove_group_member are all owner-gated", async () => {
    const created = (await dispatch("create_group", { name: "Sales" }, orgId, orgSlug, "apikey-1", "owner-1")) as {
      id: string;
    };

    await expect(
      dispatch("update_group", { group_id: created.id, name: "Revenue" }, orgId, orgSlug, "apikey-1", "member-1")
    ).rejects.toThrow("only org owners/admins can rename groups");

    await expect(
      dispatch(
        "add_group_member",
        { group_id: created.id, user_ids: JSON.stringify(["member-1"]) },
        orgId,
        orgSlug,
        "apikey-1",
        "member-1"
      )
    ).rejects.toThrow("only org owners/admins can manage group membership");

    await expect(
      dispatch("remove_group_member", { group_id: created.id, user_id: "member-1" }, orgId, orgSlug, "apikey-1", "member-1")
    ).rejects.toThrow("only org owners/admins can manage group membership");

    await expect(
      dispatch("delete_group", { group_id: created.id }, orgId, orgSlug, "apikey-1", "member-1")
    ).rejects.toThrow("only org owners/admins can delete groups");
  });

  it("add_group_member accepts a JSON array of multiple user ids from an owner", async () => {
    await testDb.orgMember.create({ data: { orgId, userId: "member-2", role: "member" } });
    const created = (await dispatch("create_group", { name: "Sales" }, orgId, orgSlug, "apikey-1", "owner-1")) as {
      id: string;
    };

    const result = (await dispatch(
      "add_group_member",
      { group_id: created.id, user_ids: JSON.stringify(["member-1", "member-2"]) },
      orgId,
      orgSlug,
      "apikey-1",
      "owner-1"
    )) as { added: string[] };

    expect(new Set(result.added)).toEqual(new Set(["member-1", "member-2"]));
  });

  it("add_group_member accepts a comma-separated string of user ids", async () => {
    const created = (await dispatch("create_group", { name: "Sales" }, orgId, orgSlug, "apikey-1", "owner-1")) as {
      id: string;
    };
    const result = (await dispatch(
      "add_group_member",
      { group_id: created.id, user_ids: "member-1" },
      orgId,
      orgSlug,
      "apikey-1",
      "owner-1"
    )) as { added: string[] };
    expect(result.added).toEqual(["member-1"]);
  });
});
