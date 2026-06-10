import { db } from "@/lib/db";
import { readPage, writePage } from "@/lib/pages";

// Every org gets a `home` page by default — the at-a-glance launcher exists
// from the first dashboard visit and users/agents update it as they please.
// Content is intentionally generic (OSS-safe); workflows overwrite the
// sections, and the prompts: block is user-curated and preserved.
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
          Edit this page to describe your workspace — agents keep the sections
          below current as part of their workflows.
  - type: section
    heading: What happened recently
    components:
      - type: markdown
        body: |
          - Nothing yet — this section fills in as agents update pages.
  - type: section
    heading: Needs attention
    components:
      - type: markdown
        body: |
          - Nothing flagged.
  - type: section
    heading: Plans in motion
    components:
      - type: markdown
        body: |
          - No active plans yet.
`;

export async function ensureHomePage(
  orgId: string,
  orgSlug: string
): Promise<{ json: Record<string, unknown>; updatedAt: Date } | null> {
  let page = await readPage(orgId, "home");
  if (!page) {
    const result = await writePage(orgId, orgSlug, "home", DEFAULT_HOME_YAML, "system");
    if (!result.ok) return null;
    page = await readPage(orgId, "home");
    if (!page) return null;
  }
  const row = await db.page.findUnique({
    where: { orgId_slug: { orgId, slug: "home" } },
    select: { updatedAt: true },
  });
  if (!row) return null;
  return { json: page.json, updatedAt: row.updatedAt };
}
