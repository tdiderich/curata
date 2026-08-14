import { db } from "./db";

// Groups: a many-to-many primitive (users sit in multiple groups) so later
// features (folder approval groups, my-groups review filter, per-group
// digest) have something to reference. v1 is CRUD + membership only — no
// wiring into folder rules, the review queue, or approvals yet.

export interface GroupRecord {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface GroupMemberSummary {
  userId: string;
  role: string;
}

export interface GroupWithMembers {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  memberCount: number;
  members: GroupMemberSummary[];
}

export interface AddMembersResult {
  added: string[];
  alreadyMember: string[];
  invalid: string[];
}

const MAX_NAME_LENGTH = 100;
const MANAGER_SYSTEM_IDS = new Set(["system", "web", "migration"]);

/** Client-side mirror lives in group-picklist.tsx if ever needed there. */
export function slugifyGroupName(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "group";
}

function validateName(name: string): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) throw new Error("name is required");
  if (trimmed.length > MAX_NAME_LENGTH) {
    throw new Error(`name must be ${MAX_NAME_LENGTH} characters or fewer`);
  }
  return trimmed;
}

export async function findGroupOrThrow(orgId: string, groupId: string): Promise<GroupRecord> {
  const group = await db.group.findFirst({ where: { id: groupId, orgId } });
  if (!group) throw new Error(`group not found: ${groupId}`);
  return group;
}

export async function createGroup(orgId: string, name: string): Promise<GroupRecord> {
  const trimmed = validateName(name);
  const slug = slugifyGroupName(trimmed);
  const existing = await db.group.findFirst({ where: { orgId, slug } });
  if (existing) throw new Error(`a group named "${trimmed}" already exists`);
  return db.group.create({ data: { orgId, name: trimmed, slug } });
}

export async function renameGroup(orgId: string, groupId: string, name: string): Promise<GroupRecord> {
  await findGroupOrThrow(orgId, groupId);
  const trimmed = validateName(name);
  const slug = slugifyGroupName(trimmed);
  const conflict = await db.group.findFirst({ where: { orgId, slug, NOT: { id: groupId } } });
  if (conflict) throw new Error(`a group named "${trimmed}" already exists`);
  return db.group.update({ where: { id: groupId }, data: { name: trimmed, slug } });
}

export async function deleteGroup(orgId: string, groupId: string): Promise<void> {
  await findGroupOrThrow(orgId, groupId);
  await db.group.delete({ where: { id: groupId } });
}

export async function listGroupsWithMembers(orgId: string): Promise<GroupWithMembers[]> {
  const groups = await db.group.findMany({
    where: { orgId },
    orderBy: { name: "asc" },
    include: { members: { orderBy: { createdAt: "asc" } } },
  });
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    slug: g.slug,
    createdAt: g.createdAt,
    memberCount: g.members.length,
    members: g.members.map((m) => ({ userId: m.userId, role: m.role })),
  }));
}

/**
 * Bulk add: skips userIds that are not an OrgMember of this org (invalid) and
 * userIds already in the group (alreadyMember) — idempotent, safe to retry.
 */
export async function addGroupMembers(
  orgId: string,
  groupId: string,
  userIds: string[],
  role: "member" | "owner" = "member"
): Promise<AddMembersResult> {
  await findGroupOrThrow(orgId, groupId);
  const uniqueIds = [...new Set(userIds.map((u) => u.trim()).filter(Boolean))];
  if (uniqueIds.length === 0) throw new Error("no valid user IDs provided");

  const orgMembers = await db.orgMember.findMany({
    where: { orgId, userId: { in: uniqueIds } },
    select: { userId: true },
  });
  const validIds = new Set(orgMembers.map((m) => m.userId));
  const invalid = uniqueIds.filter((id) => !validIds.has(id));

  const existing = await db.groupMember.findMany({
    where: { groupId, userId: { in: uniqueIds } },
    select: { userId: true },
  });
  const alreadyMember = existing.map((m) => m.userId);
  const alreadySet = new Set(alreadyMember);

  const toAdd = uniqueIds.filter((id) => validIds.has(id) && !alreadySet.has(id));
  if (toAdd.length > 0) {
    await db.groupMember.createMany({
      data: toAdd.map((userId) => ({ groupId, userId, role })),
      skipDuplicates: true,
    });
  }

  return { added: toAdd, alreadyMember, invalid };
}

export async function removeGroupMember(orgId: string, groupId: string, userId: string): Promise<void> {
  await findGroupOrThrow(orgId, groupId);
  await db.groupMember.deleteMany({ where: { groupId, userId } });
}

export async function setGroupMemberRole(
  orgId: string,
  groupId: string,
  userId: string,
  role: "member" | "owner"
): Promise<void> {
  await findGroupOrThrow(orgId, groupId);
  const member = await db.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } } });
  if (!member) throw new Error("user is not a member of this group");
  await db.groupMember.update({ where: { groupId_userId: { groupId, userId } }, data: { role } });
}

/**
 * Mirrors the special-cased system userIds in resolveOrgFromApiKey (auth.ts)
 * that already get treated as org owner — a key created by "system" is
 * already omnipotent, so group management follows the same rule instead of
 * inventing a second standard.
 */
export async function isOrgManager(orgId: string, userId?: string): Promise<boolean> {
  if (!userId) return false;
  if (MANAGER_SYSTEM_IDS.has(userId)) return true;
  const member = await db.orgMember.findUnique({ where: { orgId_userId: { orgId, userId } } });
  return member?.role === "owner" || member?.role === "admin";
}

export async function assertGroupManager(orgId: string, userId: string | undefined, action: string): Promise<void> {
  const allowed = await isOrgManager(orgId, userId);
  if (!allowed) throw new Error(`only org owners/admins can ${action}`);
}
