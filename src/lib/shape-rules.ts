/**
 * Org-authored shape rules: `kind: "shape"` entries in the same JSON rules
 * column content, approval, trust, and required-components rules share.
 * They ride into `kazam validate` as `shape_rules` in a temporary
 * `kazam.yaml`, so the Rust engine evaluates built-in and org rules together.
 */
import { db } from "@/lib/db";

export interface ShapeRule {
  id: string;
  kind: "shape";
  component: string;
  warn: string;
  say: string;
  severity?: "warning" | "error";
}

export interface ResolvedShapeRule extends ShapeRule {
  scope: string;
}

export function parseShapeRules(json: unknown): ShapeRule[] {
  if (!json || !Array.isArray(json)) return [];
  return json
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null && (r as Record<string, unknown>).kind === "shape")
    .filter((r) => typeof r.component === "string" && typeof r.warn === "string" && typeof r.say === "string")
    .map((r) => ({
      id: typeof r.id === "string" && r.id ? r.id : `${r.component}-${String(r.warn).slice(0, 24)}`,
      kind: "shape" as const,
      component: (r.component as string).trim(),
      warn: (r.warn as string).trim(),
      say: (r.say as string).trim(),
      ...(r.severity === "error" ? { severity: "error" as const } : {}),
    }));
}

export function validateShapeRule(candidate: unknown): { ok: true; rule: ShapeRule } | { ok: false; error: string } {
  if (!candidate || typeof candidate !== "object") return { ok: false, error: "rule must be an object" };
  const r = candidate as Record<string, unknown>;
  if (typeof r.component !== "string" || !r.component.trim()) return { ok: false, error: "component is required" };
  if (typeof r.warn !== "string" || !r.warn.trim()) return { ok: false, error: "warn (expression) is required" };
  if (typeof r.say !== "string" || !r.say.trim()) return { ok: false, error: "say (the fix to show the author) is required" };
  if (r.severity !== undefined && r.severity !== "warning" && r.severity !== "error") {
    return { ok: false, error: 'severity must be "warning" or "error"' };
  }
  const [rule] = parseShapeRules([{ ...r, kind: "shape" }]);
  return { ok: true, rule };
}

/** org -> folder ancestry -> page, accumulating like resolveRules does. */
export async function resolveShapeRules(
  orgId: string,
  folderId: string | null,
  pageRulesJson: unknown
): Promise<ResolvedShapeRule[]> {
  const out: ResolvedShapeRule[] = [];
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { rules: true } });
  for (const r of parseShapeRules(org?.rules)) out.push({ ...r, scope: "global" });

  if (folderId) {
    const folders = await db.folder.findMany({ where: { orgId }, select: { id: true, parentId: true, name: true, rules: true } });
    const byId = new Map(folders.map((f) => [f.id, f]));
    const ancestry: typeof folders = [];
    let cur = byId.get(folderId);
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      ancestry.unshift(cur);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    for (const f of ancestry) {
      for (const r of parseShapeRules(f.rules)) out.push({ ...r, scope: `folder:${f.name}` });
    }
  }

  for (const r of parseShapeRules(pageRulesJson)) out.push({ ...r, scope: "page" });
  return out;
}

/** Shape rules as the `shape_rules:` list kazam.yaml expects. */
export function toKazamShapeRules(rules: ShapeRule[]): Array<Record<string, string>> {
  return rules.map((r) => ({
    component: r.component,
    warn: r.warn,
    say: r.say,
    ...(r.severity ? { severity: r.severity } : {}),
  }));
}
