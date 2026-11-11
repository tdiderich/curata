import { db } from "./db";
import { pageAccessFor, pageEditable } from "./access";
import { resolveToolName, TOOL_PARAMS } from "./mcp-dispatch";

/// Tools that change an existing page's content or placement. On a private
/// page these need the creator or an editor share, not just a view.
const PAGE_EDIT_TOOLS = new Set([
  "write_page",
  "patch_page",
  "write_component",
  "replace_in_page",
  "restore_page_version",
  "move_page",
]);

/// Every argument that names a page, across both MCP transports. A new
/// page-naming param in TOOL_PARAMS (mcp-dispatch.ts) must be added here;
/// tests/page-access-routes.test.ts fails if one is missed.
export const PAGE_ARGS = ["slug", "template_slug", "target_slug", "superseded_by", "scope_id", "slugs", "asserts", "depends", "references"] as const;

/// Each slug a call names must be a page the caller can see, the same rule
/// list_pages and search_pages already apply (listPagesWhere).
function slugList(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return v.split(",").map((x) => x.trim());
  }
}

/// Callers may send camelCase aliases (templateSlug, supersededBy); the tool
/// reads the canonical name, so the check must too.
function canonicalArgs(tool: string, args: Record<string, unknown>): Record<string, unknown> {
  const aliases = TOOL_PARAMS[tool]?.aliases;
  if (!aliases) return args;
  const out = { ...args };
  for (const [alias, canonical] of Object.entries(aliases)) {
    if (alias in out && !(canonical in out)) out[canonical] = out[alias];
  }
  return out;
}

function pageSlugs(tool: string, args: Record<string, unknown>): { view: string[]; edit: string[] } {
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const view = [args.slug, args.template_slug, args.target_slug, args.superseded_by].map(str);
  const edit: (string | null)[] = [];

  if (tool === "set_rules" && args.scope === "page") edit.push(str(args.scope_id));
  if (PAGE_EDIT_TOOLS.has(tool)) edit.push(str(args.slug));

  // Slug lists: export_report slugs, map_dependencies asserts/depends/
  // references. Same parsing as the tools: JSON array, else comma list.
  for (const key of ["slugs", "asserts", "depends", "references"]) {
    view.push(...slugList(args[key]).map(str));
  }

  const clean = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => x !== null))];
  return { view: clean(view), edit: clean(edit) };
}

/**
 * Returns an error message when a tool call names a page the caller can't
 * see, or wants to change a private page it only holds a viewer share on;
 * null when the call may proceed. A slug with no page behind it passes:
 * creating tools need that, and the rest already answer "page not found".
 * The message for a hidden page matches the not-found one, so a caller
 * can't probe which private slugs exist.
 *
 * userId undefined means an internal caller, which listPagesWhere also
 * leaves unfiltered.
 */
export async function mcpPageDenial(
  tool: string,
  args: Record<string, unknown> | undefined,
  orgId: string,
  userId: string | undefined
): Promise<string | null> {
  if (!args || !userId) return null;
  const name = resolveToolName(tool);
  const { view, edit } = pageSlugs(name, canonicalArgs(name, args));
  const slugs = [...new Set([...view, ...edit])];
  if (slugs.length === 0) return null;

  const pages = await db.page.findMany({
    where: { orgId, slug: { in: slugs } },
    select: { id: true, orgId: true, slug: true, visibility: true, createdBy: true },
  });

  for (const page of pages) {
    // Any org role grants org-level visibility; MCP callers are org members.
    const access = await pageAccessFor(page, userId, "member");
    if (!access) return `page not found: ${page.slug}`;
    if (edit.includes(page.slug) && !pageEditable(page, access)) {
      return `forbidden: you have view-only access to page ${page.slug}`;
    }
  }
  return null;
}
