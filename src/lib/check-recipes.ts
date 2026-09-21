/**
 * Check recipes: how an agent verifies an external asset through its own
 * MCPs. Pure helpers, safe to import from client components.
 */
export interface CheckRecipe {
  /** MCP server as the agent's session names it: hubspot, google-drive, github... */
  via: string;
  tool?: string;
  locator?: string;
  ask?: string;
}

export function parseCheckRecipe(raw: unknown): CheckRecipe | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("check must be an object like {via, tool?, locator?, ask?}");
  const r = raw as Record<string, unknown>;
  if (typeof r.via !== "string" || !r.via.trim()) throw new Error("check.via is required: the MCP server name the agent will use");
  const out: CheckRecipe = { via: r.via.trim() };
  for (const k of ["tool", "locator", "ask"] as const) {
    if (r[k] === undefined || r[k] === null) continue;
    if (typeof r[k] !== "string") throw new Error(`check.${k} must be a string`);
    out[k] = (r[k] as string).trim();
  }
  return out;
}

const RECIPE_BY_HOST: Array<[RegExp, CheckRecipe]> = [
  [/(^|\.)hubspot\.com$/, { via: "hubspot", tool: "render_asset", ask: "Does this page still match the source?" }],
  [/(^|\.)docs\.google\.com$|(^|\.)drive\.google\.com$/, { via: "google-drive", tool: "read_file_content", ask: "Does this document still match the source?" }],
  [/(^|\.)github\.com$/, { via: "fetch", tool: "WebFetch", ask: "Does the file at this URL still match the source?" }],
  [/(^|\.)notion\.so$|(^|\.)notion\.site$/, { via: "notion", ask: "Does this page still match the source?" }],
  [/(^|\.)linear\.app$/, { via: "linear", tool: "get_issue", ask: "Is the issue description still right?" }],
  [/(^|\.)atlassian\.net$/, { via: "atlassian", ask: "Does this page still match the source?" }],
  [/(^|\.)zendesk\.com$/, { via: "zendesk", ask: "Does this macro or article still match the source?" }],
];

/** A starting recipe by host, or null when nobody knows how to check that domain. */
export function suggestCheck(url: string): CheckRecipe | null {
  let host: string;
  try { host = new URL(url).host.toLowerCase().replace(/^www\./, ""); } catch { return null; }
  for (const [re, recipe] of RECIPE_BY_HOST) if (re.test(host)) return { ...recipe, locator: url };
  return null;
}
