import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";

// Approval rules ride the same JSON `rules` column (org/folder/page) as
// ContentRule, distinguished by `kind: "approval"`. content-rules.ts's
// parseRules() already ignores these (it requires `text`), so the two rule
// kinds coexist in the same array without stepping on each other.

export interface ApprovalApprover {
  type: "user" | "group";
  /** userId for type "user", Group.id for type "group". */
  id: string;
}

export interface ApprovalRule {
  id: string;
  kind: "approval";
  approvers: ApprovalApprover[];
}

/** Singleton convention: one approval rule per scope, always this id. */
export const APPROVAL_RULE_ID = "approval";

function isApproverShape(v: unknown): v is ApprovalApprover {
  if (!v || typeof v !== "object") return false;
  const a = v as Record<string, unknown>;
  return (a.type === "user" || a.type === "group") && typeof a.id === "string" && a.id.trim().length > 0;
}

/** Pulls approval-kind entries out of a scope's raw rules JSON, ignoring content rules. */
export function parseApprovalRules(json: unknown): ApprovalRule[] {
  if (!json || !Array.isArray(json)) return [];
  return json
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null && (r as Record<string, unknown>).kind === "approval")
    .filter((r) => typeof r.id === "string" && Array.isArray(r.approvers) && (r.approvers as unknown[]).every(isApproverShape))
    .map((r) => ({
      id: r.id as string,
      kind: "approval" as const,
      approvers: r.approvers as ApprovalApprover[],
    }));
}

/**
 * Validates a candidate approval rule body (from /api/rules POST/PUT or the
 * set_rules MCP tool). Mirrors validateRule()'s shape in api/rules/route.ts
 * for content rules — same "ok/error" result style.
 */
export function validateApprovalRule(
  candidate: unknown
): { ok: true; rule: ApprovalRule } | { ok: false; error: string } {
  if (!candidate || typeof candidate !== "object") {
    return { ok: false, error: "rule must be an object" };
  }
  const r = candidate as Record<string, unknown>;
  if (!Array.isArray(r.approvers) || r.approvers.length === 0) {
    return { ok: false, error: "approvers must be a non-empty array" };
  }
  for (const a of r.approvers) {
    if (!isApproverShape(a)) {
      return { ok: false, error: "each approver must be { type: \"user\"|\"group\", id: string }" };
    }
  }
  return {
    ok: true,
    rule: {
      id: typeof r.id === "string" && r.id ? r.id : APPROVAL_RULE_ID,
      kind: "approval",
      approvers: r.approvers as ApprovalApprover[],
    },
  };
}

export interface EffectiveApprovalRule {
  rule: ApprovalRule;
  /** "global" | "folder:<name>" | "page" — mirrors ResolvedRule.scope in content-rules.ts. */
  scope: string;
}

/**
 * Resolves the *effective* approval rule for a page: unlike content rules
 * (which accumulate across every scope), an approval rule is a single gate —
 * the most specific scope that defines one wins outright rather than
 * merging approver lists across scopes. Priority: page > nearest folder
 * ancestor > global. Returns null when no scope in the cascade sets one
 * (current unrestricted "anyone with page:edit can approve" behavior).
 */
export async function resolveEffectiveApprovalRule(
  orgId: string,
  folderId: string | null,
  pageRulesJson: unknown
): Promise<EffectiveApprovalRule | null> {
  const pageRules = parseApprovalRules(pageRulesJson);
  if (pageRules.length > 0) return { rule: pageRules[0], scope: "page" };

  if (folderId) {
    const folders = await db.folder.findMany({
      where: { orgId },
      select: { id: true, parentId: true, name: true, rules: true },
    });
    const folderMap = new Map(folders.map((f) => [f.id, f]));

    const ancestry: typeof folders = [];
    let current = folderMap.get(folderId);
    const visited = new Set<string>();
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      ancestry.unshift(current);
      current = current.parentId ? folderMap.get(current.parentId) : undefined;
    }

    // Closest ancestor first (end of ancestry array is the immediate parent chain to folderId).
    for (let i = ancestry.length - 1; i >= 0; i--) {
      const folder = ancestry[i];
      const rules = parseApprovalRules(folder.rules);
      if (rules.length > 0) return { rule: rules[0], scope: `folder:${folder.name}` };
    }
  }

  const org = await db.organization.findUnique({ where: { id: orgId }, select: { rules: true } });
  const orgRules = parseApprovalRules(org?.rules);
  if (orgRules.length > 0) return { rule: orgRules[0], scope: "global" };

  return null;
}

/** Resolves the effective approval rule for a page by slug (single-page callers: trust route, page view). */
export async function getApprovers(orgId: string, slug: string): Promise<EffectiveApprovalRule | null> {
  const page = await db.page.findUnique({
    where: { orgId_slug: { orgId, slug } },
    select: { folderId: true, rules: true },
  });
  if (!page) return null;
  return resolveEffectiveApprovalRule(orgId, page.folderId, page.rules);
}

async function resolveApproverNames(orgId: string, approvers: ApprovalApprover[]): Promise<string[]> {
  const groupIds = approvers.filter((a) => a.type === "group").map((a) => a.id);
  const groupNameById = new Map<string, string>();
  if (groupIds.length > 0) {
    const groups = await db.group.findMany({ where: { orgId, id: { in: groupIds } }, select: { id: true, name: true } });
    for (const g of groups) groupNameById.set(g.id, g.name);
  }
  return approvers.map((a) => (a.type === "group" ? groupNameById.get(a.id) ?? a.id : a.id));
}

/** Short muted-note text for gated UI: "approval limited to: Test, bob@company.com". */
export async function describeApprovalRule(orgId: string, rule: ApprovalRule): Promise<string> {
  const names = await resolveApproverNames(orgId, rule.approvers);
  return `approval limited to: ${names.join(", ")}`;
}

async function isUserEligible(orgId: string, userId: string, rule: ApprovalRule): Promise<boolean> {
  const directHit = rule.approvers.some((a) => a.type === "user" && a.id === userId);
  if (directHit) return true;

  const groupIds = rule.approvers.filter((a) => a.type === "group").map((a) => a.id);
  if (groupIds.length === 0) return false;

  const membership = await db.groupMember.findFirst({
    where: { userId, groupId: { in: groupIds }, group: { orgId } },
    select: { id: true },
  });
  return !!membership;
}

/**
 * Eligibility for approving/trusting a version. Org owners/admins are always
 * eligible — an escape hatch so a misconfigured approval rule can never lock
 * an org out of its own content. Otherwise: no rule anywhere in the cascade
 * means anyone (the caller must still separately check page:edit); a rule
 * present means direct-user listing or group membership.
 */
export async function canApprove(orgId: string, userId: string, orgRole: Role, slug: string): Promise<boolean> {
  if (orgRole === "owner" || orgRole === "admin") return true;

  const resolved = await getApprovers(orgId, slug);
  if (!resolved) return true;

  return isUserEligible(orgId, userId, resolved.rule);
}

export interface BatchApprovalRow {
  slug: string;
  eligible: boolean;
  /** Present whenever a rule governs this page, regardless of the caller's eligibility — lets ineligible UI show who is. */
  restrictionNote: string | null;
}

/**
 * Batch eligibility for the review queue — avoids the N+1 of calling
 * getApprovers/canApprove per row. One page query, one folder query (whole
 * org, cheap and already the shape content-rules.ts and detectFolderCycle
 * use), one org query, one group-membership query, all up front.
 */
export async function canApproveBatch(
  orgId: string,
  userId: string,
  orgRole: Role,
  slugs: string[]
): Promise<Map<string, BatchApprovalRow>> {
  const result = new Map<string, BatchApprovalRow>();
  if (slugs.length === 0) return result;

  const isAdmin = orgRole === "owner" || orgRole === "admin";

  const [pages, folders, org] = await Promise.all([
    db.page.findMany({
      where: { orgId, slug: { in: slugs } },
      select: { slug: true, folderId: true, rules: true },
    }),
    db.folder.findMany({ where: { orgId }, select: { id: true, parentId: true, name: true, rules: true } }),
    db.organization.findUnique({ where: { id: orgId }, select: { rules: true } }),
  ]);

  const folderMap = new Map(folders.map((f) => [f.id, f]));
  const orgRules = parseApprovalRules(org?.rules);

  function effectiveFor(folderId: string | null, pageRulesJson: unknown): EffectiveApprovalRule | null {
    const pageRules = parseApprovalRules(pageRulesJson);
    if (pageRules.length > 0) return { rule: pageRules[0], scope: "page" };

    if (folderId) {
      const ancestry: typeof folders = [];
      let current = folderMap.get(folderId);
      const visited = new Set<string>();
      while (current && !visited.has(current.id)) {
        visited.add(current.id);
        ancestry.unshift(current);
        current = current.parentId ? folderMap.get(current.parentId) : undefined;
      }
      for (let i = ancestry.length - 1; i >= 0; i--) {
        const folder = ancestry[i];
        const rules = parseApprovalRules(folder.rules);
        if (rules.length > 0) return { rule: rules[0], scope: `folder:${folder.name}` };
      }
    }

    if (orgRules.length > 0) return { rule: orgRules[0], scope: "global" };
    return null;
  }

  const effectiveByPage = new Map<string, EffectiveApprovalRule | null>();
  for (const p of pages) effectiveByPage.set(p.slug, effectiveFor(p.folderId, p.rules));

  const allGroupIds = new Set<string>();
  for (const eff of effectiveByPage.values()) {
    if (!eff) continue;
    for (const a of eff.rule.approvers) if (a.type === "group") allGroupIds.add(a.id);
  }

  let userGroupIds = new Set<string>();
  if (!isAdmin && allGroupIds.size > 0) {
    const memberships = await db.groupMember.findMany({
      where: { userId, groupId: { in: [...allGroupIds] } },
      select: { groupId: true },
    });
    userGroupIds = new Set(memberships.map((m) => m.groupId));
  }

  const namesCache = new Map<string, string>(); // groupId -> name, resolved lazily below
  if (allGroupIds.size > 0) {
    const groups = await db.group.findMany({ where: { orgId, id: { in: [...allGroupIds] } }, select: { id: true, name: true } });
    for (const g of groups) namesCache.set(g.id, g.name);
  }

  for (const slug of slugs) {
    const eff = effectiveByPage.get(slug) ?? null;
    if (!eff) {
      result.set(slug, { slug, eligible: true, restrictionNote: null });
      continue;
    }

    const eligible =
      isAdmin ||
      eff.rule.approvers.some((a) => a.type === "user" && a.id === userId) ||
      eff.rule.approvers.some((a) => a.type === "group" && userGroupIds.has(a.id));

    const names = eff.rule.approvers.map((a) => (a.type === "group" ? namesCache.get(a.id) ?? a.id : a.id));
    result.set(slug, { slug, eligible, restrictionNote: `approval limited to: ${names.join(", ")}` });
  }

  return result;
}
