import { readPage, writePage } from "@/lib/pages";

// Every org gets a `home` page by default — it backs the at-a-glance
// dashboard. The page is a stash, not a report: it holds the orientation
// prose and the user-curated `prompts:` block (custom prompt cards). The
// standard glance cards are computed live from the DB on every dashboard
// load, so nothing here goes stale. An agent can still add sections with
// the standard headings ("Needs attention", etc.) to override a live card
// with written synthesis.
const DEFAULT_HOME_YAML = `title: At a glance
shell: standard
prompts:
  - title: Tour this workspace
    description: Walks you through the folders, pages, and conventions of this workspace.
    prompt: |
      Use list_pages and the folder structure to map this curata workspace,
      then give me a guided tour: what each folder is for, the most important
      pages, and how the pieces relate. End with where I should start reading.
components:
  - type: section
    heading: What this workspace is
    components:
      - type: markdown
        body: |
          Your agent-maintained knowledge base. Pages are written and updated by
          AI agents through the MCP API; humans read, annotate, and spot-check.
          Edit this page to describe your workspace and stash custom prompt
          cards in the prompts block — they show up on the dashboard.
`;

export async function ensureHomePage(
  orgId: string,
  orgSlug: string
): Promise<Record<string, unknown> | null> {
  let page = await readPage(orgId, "home");
  if (!page) {
    const result = await writePage(orgId, orgSlug, "home", DEFAULT_HOME_YAML, "system");
    if (!result.ok) return null;
    page = await readPage(orgId, "home");
    if (!page) return null;
  }
  return page.json;
}
