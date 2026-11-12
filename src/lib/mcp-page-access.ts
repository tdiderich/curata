import { db } from "./db";
import { slugInUseMessage } from "./slug-in-use";
import { OWNER_ONLY_MESSAGE, ownerActionAllowed, pageAccessFor, pageEditable, VIEW_ONLY_MESSAGE } from "./access";
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

/// Tools whose own answer to a missing page differs from "page not found:
/// X" (a fallback, an empty result, a `missing` list). They check visibility
/// themselves with the caller's userId, so a hidden page gets exactly the
/// missing-page answer.
const SELF_FILTERING_TOOLS = new Set(["list_rules", "validate_page", "get_related", "get_dependents", "map_dependencies"]);

/// Tools that create a page at a new slug, and the arg naming it. A slug held
/// by a page the caller can't see answers with slugInUseMessage, the same
/// words the tool gives for a visible one. The failure itself can't be hidden, since
/// slugs are unique per org, but the message doesn't single out hidden pages.
const CREATE_SLUG_ARG: Record<string, string> = {
  create_page: "slug",
  write_page: "slug",
  create_from_template: "target_slug",
};

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
  // superseded_by is stored as a plain slug and never looked up, so a
  // missing one is accepted; a hidden one must be too.
  const view = [args.slug, args.template_slug, args.target_slug].map(str);
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
  if (SELF_FILTERING_TOOLS.has(name)) return null;
  const canon = canonicalArgs(name, args);
  const { view, edit } = pageSlugs(name, canon);
  const slugs = [...new Set([...view, ...edit])];
  if (slugs.length === 0) return null;

  const rows = await db.page.findMany({
    where: { orgId, slug: { in: slugs } },
    select: { id: true, orgId: true, slug: true, visibility: true, createdBy: true },
  });
  const bySlug = new Map(rows.map((p) => [p.slug, p]));
  const createArg = CREATE_SLUG_ARG[name];
  const createSlug = createArg ? canon[createArg] : undefined;

  // Visibility for every named page first, in argument order, so a call that
  // names both a hidden page and a view-only one always gets the hidden
  // page's answer, whatever order the rows come back in.
  const checked = [];
  for (const slug of slugs) {
    const page = bySlug.get(slug);
    if (!page) continue;
    // Any org role grants org-level visibility; MCP callers are org members.
    const access = await pageAccessFor(page, userId, "member");
    if (!access) return hiddenAnswer(orgId, name, canon, slug, createSlug);
    checked.push({ page, access });
  }
  for (const { page, access } of checked) {
    if (edit.includes(page.slug) && !pageEditable(page, access)) return `${VIEW_ONLY_MESSAGE}: ${page.slug}`;
    if (changesVisibility(name, canon, page, createSlug) && !ownerActionAllowed(page, access)) return OWNER_ONLY_MESSAGE;
  }
  return null;
}

/// What the tool itself says when the slug has no page, so a hidden page
/// gets the same words.
async function hiddenAnswer(orgId: string, tool: string, args: Record<string, unknown>, slug: string, createSlug: unknown): Promise<string> {
  if (slug === createSlug) return slugInUseMessage(orgId, slug);
  if (tool === "create_from_template" && slug === args.template_slug) return `template not found: ${slug}`;
  return `page not found: ${slug}`;
}

/// write_page's visibility arg on an existing page; owner-only on a private
/// page, like PATCH /api/pages.
function changesVisibility(tool: string, args: Record<string, unknown>, page: { slug: string; visibility: string }, createSlug: unknown): boolean {
  const vis = args.visibility;
  return tool === "write_page" && page.slug === createSlug && typeof vis === "string" && vis !== "" && vis !== page.visibility;
}
