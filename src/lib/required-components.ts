import { db } from "@/lib/db";
import { collectComponentIds } from "@/lib/component-ids";
import type { RuleViolation } from "@/lib/content-rules";
import yaml from "js-yaml";

// required-components rules ride the same JSON `rules` column (org/folder/page)
// as ContentRule and ApprovalRule, distinguished by `kind: "required-components"`.
// content-rules.ts's parseRules() already ignores these (it requires `text`),
// so all three rule kinds coexist in the same array without stepping on each
// other. Unlike the approval kind (one gate, most-specific scope wins), these
// accumulate across scopes exactly like content rules — every rule whose
// `pageType` matches the page's declared `pageType` field applies.
//
// A page opts into a type by setting a top-level `pageType: <name>` field in
// its YAML (verified against the `kazam validate` CLI: unrecognized top-level
// keys are not rejected, so this rides alongside title/shell/components with
// no schema changes). The rule only ever fires for pages that declare a
// matching `pageType` — pages with no `pageType` field are never touched by
// any required-components rule, so this is additive and can't regress the
// bulk of untyped pages already in a site.

export interface RequiredComponentsRule {
  id: string;
  kind: "required-components";
  /** Page type name this rule enforces, e.g. "captured-qa". Matched against the page's own `pageType` field. */
  pageType: string;
  /** Component ids (see component-ids.ts) that must be present somewhere in the page's components tree. */
  requiredComponentIds: string[];
  /** Top-level page fields (title, subtitle, eyebrow...) that must be present and non-empty. */
  requiredFields?: string[];
  /** If true, the page must carry at least one concept tag (see concepts.ts) after the write. */
  requireConcepts?: boolean;
  /**
   * If true, create_page (and write_page when it's creating a brand-new
   * slug) for this pageType is rejected without a valid capture_token +
   * dedup_ack from capture_thread (see capture-token.ts / capture-gate.ts).
   * Updates to an existing page (patch_page, write_page on an existing
   * slug) are never gated — dedup only guards against creating a fresh
   * near-duplicate, not editing one that already exists.
   *
   * The shipped "captured-qa" rule sets this, so blind create_page calls
   * for that type are rejected out of the box and the error teaches the
   * choreography. An org can relax it (or gate other types) via set_rules.
   */
  captureRequired?: boolean;
}

export interface ResolvedRequiredComponentsRule extends RequiredComponentsRule {
  /** "global" | "folder:<name>" | "page" — mirrors ResolvedRule.scope in content-rules.ts. */
  scope: string;
}

export interface RequiredComponentsRulesResponse {
  inherited: ResolvedRequiredComponentsRule[];
  page: ResolvedRequiredComponentsRule[];
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string" && x.trim().length > 0);
}

/** Pulls required-components-kind entries out of a scope's raw rules JSON, ignoring other rule kinds. */
export function parseRequiredComponentsRules(json: unknown): RequiredComponentsRule[] {
  if (!json || !Array.isArray(json)) return [];
  return json
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null && (r as Record<string, unknown>).kind === "required-components")
    .filter((r) => typeof r.id === "string" && typeof r.pageType === "string" && r.pageType.trim().length > 0)
    .filter((r) => r.requiredComponentIds === undefined || isStringArray(r.requiredComponentIds))
    .filter((r) => r.requiredFields === undefined || isStringArray(r.requiredFields))
    .map((r) => ({
      id: r.id as string,
      kind: "required-components" as const,
      pageType: (r.pageType as string).trim(),
      requiredComponentIds: isStringArray(r.requiredComponentIds) ? r.requiredComponentIds : [],
      ...(isStringArray(r.requiredFields) ? { requiredFields: r.requiredFields } : {}),
      ...(typeof r.requireConcepts === "boolean" ? { requireConcepts: r.requireConcepts } : {}),
      ...(typeof r.captureRequired === "boolean" ? { captureRequired: r.captureRequired } : {}),
    }));
}

/**
 * Validates a candidate required-components rule body (from /api/rules
 * POST/PUT or the set_rules MCP tool). Mirrors validateApprovalRule's
 * "ok/error" result shape.
 */
export function validateRequiredComponentsRule(
  candidate: unknown
): { ok: true; rule: RequiredComponentsRule } | { ok: false; error: string } {
  if (!candidate || typeof candidate !== "object") {
    return { ok: false, error: "rule must be an object" };
  }
  const r = candidate as Record<string, unknown>;

  if (typeof r.pageType !== "string" || r.pageType.trim().length === 0) {
    return { ok: false, error: "pageType is required" };
  }
  if (r.requiredComponentIds !== undefined && !isStringArray(r.requiredComponentIds)) {
    return { ok: false, error: "requiredComponentIds must be an array of non-empty strings" };
  }
  if (r.requiredFields !== undefined && !isStringArray(r.requiredFields)) {
    return { ok: false, error: "requiredFields must be an array of non-empty strings" };
  }
  if (r.requireConcepts !== undefined && typeof r.requireConcepts !== "boolean") {
    return { ok: false, error: "requireConcepts must be a boolean" };
  }
  if (r.captureRequired !== undefined && typeof r.captureRequired !== "boolean") {
    return { ok: false, error: "captureRequired must be a boolean" };
  }

  const requiredComponentIds = isStringArray(r.requiredComponentIds) ? r.requiredComponentIds : [];
  const requiredFields = isStringArray(r.requiredFields) ? r.requiredFields : undefined;
  const requireConcepts = typeof r.requireConcepts === "boolean" ? r.requireConcepts : undefined;
  const captureRequired = typeof r.captureRequired === "boolean" ? r.captureRequired : undefined;

  if (requiredComponentIds.length === 0 && (!requiredFields || requiredFields.length === 0) && !requireConcepts) {
    return { ok: false, error: "rule must require at least one component id, field, or concept tag" };
  }

  return {
    ok: true,
    rule: {
      id: typeof r.id === "string" && r.id ? r.id : crypto.randomUUID().slice(0, 8),
      kind: "required-components",
      pageType: r.pageType.trim(),
      requiredComponentIds,
      ...(requiredFields ? { requiredFields } : {}),
      ...(requireConcepts !== undefined ? { requireConcepts } : {}),
      ...(captureRequired !== undefined ? { captureRequired } : {}),
    },
  };
}

function tagRules(rules: RequiredComponentsRule[], scope: string): ResolvedRequiredComponentsRule[] {
  return rules.map((r) => ({ ...r, scope }));
}

/** Pulls the top-level `pageType` field off a page's YAML, or undefined if absent/malformed/untyped. */
export function extractDeclaredPageType(content: string): string | undefined {
  let parsed: Record<string, unknown>;
  try {
    parsed = yaml.load(content) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  return typeof parsed.pageType === "string" && parsed.pageType.trim().length > 0
    ? parsed.pageType.trim()
    : undefined;
}

/** True if any resolved rule for this pageType opts into the capture_thread gate on create (see RequiredComponentsRule.captureRequired). */
export function isCaptureRequired(rules: ResolvedRequiredComponentsRule[], pageType: string): boolean {
  return rules.some((r) => r.pageType === pageType && r.captureRequired === true);
}

/**
 * Resolves every required-components rule in scope for a page: global,
 * every folder ancestor, and the page itself — same cascade content-rules.ts
 * walks, and rules from every level accumulate (unlike the approval kind's
 * single most-specific-scope winner).
 */
export async function resolveRequiredComponentsRules(
  orgId: string,
  folderId: string | null,
  pageRulesJson: unknown
): Promise<RequiredComponentsRulesResponse> {
  const inherited: ResolvedRequiredComponentsRule[] = [];

  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { rules: true },
  });
  if (org?.rules) {
    inherited.push(...tagRules(parseRequiredComponentsRules(org.rules), "global"));
  }

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

    for (const folder of ancestry) {
      const folderRules = parseRequiredComponentsRules(folder.rules);
      if (folderRules.length > 0) {
        inherited.push(...tagRules(folderRules, `folder:${folder.name}`));
      }
    }
  }

  const pageRules = tagRules(parseRequiredComponentsRules(pageRulesJson), "page");

  return { inherited, page: pageRules };
}

/**
 * Checks a page's YAML content (and its resulting concept-tag count) against
 * every resolved required-components rule whose `pageType` matches the
 * page's own declared `pageType` field. Pages with no `pageType` field never
 * match any rule. Returns one violation per unsatisfied rule, citing exactly
 * which components/fields/tags are missing — mirrors validateContentRules'
 * shape so mcp-dispatch.ts can format both the same way.
 */
export function validateRequiredComponents(
  content: string,
  resultingConceptCount: number,
  rules: ResolvedRequiredComponentsRule[]
): RuleViolation[] {
  if (rules.length === 0) return [];

  const declaredType = extractDeclaredPageType(content);
  if (!declaredType) return [];

  const applicable = rules.filter((r) => r.pageType === declaredType);
  if (applicable.length === 0) return [];

  let parsed: Record<string, unknown>;
  try {
    parsed = yaml.load(content) as Record<string, unknown>;
  } catch {
    // Malformed YAML is caught by the schema validator elsewhere; nothing to check here.
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];

  const components = Array.isArray(parsed.components) ? (parsed.components as Record<string, unknown>[]) : [];
  const presentIds = collectComponentIds(components);

  const violations: RuleViolation[] = [];
  for (const rule of applicable) {
    const missingComponents = rule.requiredComponentIds.filter((id) => !presentIds.has(id));
    const missingFields = (rule.requiredFields ?? []).filter((field) => {
      const value = parsed[field];
      return value === undefined || value === null || (typeof value === "string" && value.trim().length === 0);
    });
    const missingConcepts = !!rule.requireConcepts && resultingConceptCount === 0;

    if (missingComponents.length === 0 && missingFields.length === 0 && !missingConcepts) continue;

    const parts: string[] = [];
    if (missingComponents.length > 0) parts.push(`missing component(s): ${missingComponents.join(", ")}`);
    if (missingFields.length > 0) parts.push(`missing field(s): ${missingFields.join(", ")}`);
    if (missingConcepts) parts.push("missing at least one concept tag");

    violations.push({
      ruleId: rule.id,
      scope: rule.scope,
      message: `page type "${rule.pageType}" requires: ${parts.join("; ")}`,
      matches: [...missingComponents, ...missingFields, ...(missingConcepts ? ["concepts"] : [])],
    });
  }

  return violations;
}

/**
 * Default required-components rule seeded onto every new org, alongside
 * DEFAULT_CONTENT_RULES. Defines the "captured-qa" page type: one page per
 * captured answer, with the question/answer/provenance shape a captured-qa
 * template starts from and at least one concept tag so it surfaces in the
 * brain map. See seed/templates/captured-qa.yaml for the matching template.
 */
export const DEFAULT_REQUIRED_COMPONENTS_RULES: RequiredComponentsRule[] = [
  {
    id: "captured-qa",
    kind: "required-components",
    pageType: "captured-qa",
    requiredComponentIds: ["question", "answer", "provenance"],
    requireConcepts: true,
    captureRequired: true,
  },
];

/**
 * Lazy backfill for orgs created before required-components existed: seeding
 * only runs at org creation, so pre-existing orgs would have an inert capture
 * gate and a null capture_thread checklist forever. Called from
 * capture_thread; merges the defaults only when the org has NO
 * required-components rules at all, so an org that customized or neutered
 * the rule keeps its version. Deleting the rule outright does mean the next
 * capture_thread re-adds it; the supported opt-out is editing the rule
 * (clear captureRequired / requiredComponentIds), which sticks.
 */
export async function ensureDefaultRequiredComponentsRules(orgId: string): Promise<void> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { rules: true } });
  if (!org) return;
  const raw = Array.isArray(org.rules) ? (org.rules as unknown[]) : [];
  const hasKind = raw.some(
    (r) => typeof r === "object" && r !== null && (r as Record<string, unknown>).kind === "required-components"
  );
  if (hasKind) return;
  await db.organization.update({
    where: { id: orgId },
    data: { rules: [...raw, ...DEFAULT_REQUIRED_COMPONENTS_RULES] as object },
  });
}
