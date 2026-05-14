export function buildAgentPrompt({
  baseUrl,
  token,
  slug,
}: {
  baseUrl: string;
  token: string;
  slug?: string;
}): string {
  const slugSection = slug ? `Target page: ${slug}\n` : "";

  const exampleSlug = slug ?? "<page-slug>";

  const workflowSection = slug
    ? `## Workflow

Start by reading the page to understand its current state:
\`\`\`bash
curl -X POST ${baseUrl}/api/mcp -H "Content-Type: application/json" -H "Authorization: Bearer ${token}" -d '{"tool": "read_page", "args": {"slug": "${slug}"}}'
\`\`\`

1. **Read the page** — call \`read_page\` with slug \`${slug}\` to get the current YAML, sections, and any open annotations.

2. **Check annotations** — review pending annotations. For each:
   - If it's an edit you agree with, mark it \`approved\` via \`update_annotation\`.
   - If it contradicts data, mark it \`ignored\` with a note.

3. **Pull fresh data** — use your connected data sources to gather current state: metrics, decisions, pipeline changes, recent activity.

4. **Draft updates** — compose updated YAML that incorporates approved annotations and fresh data. Use \`get_component_reference\` if you need to check component syntax.

5. **Write the page** — call \`write_page\` with the updated YAML. The site rebuilds automatically.

6. **Mark incorporated** — for each annotation you folded into the page, call \`update_annotation\` with status \`incorporated\`.

7. **Add a summary annotation** — call \`annotate_page\` with \`kind: note\` summarizing what changed and why, so the human reviewer has context.`
    : `## Workflow

1. **List pages** — call \`list_pages\` to see all pages in the knowledge base.

2. **Pick a page** — choose the most relevant page to update, or iterate over all of them.

3. **Read the page** — call \`read_page\` with the chosen slug to get current YAML, sections, and open annotations.

4. **Check annotations** — review pending annotations. For each:
   - If it's an edit you agree with, mark it \`approved\` via \`update_annotation\`.
   - If it contradicts data, mark it \`ignored\` with a note.

5. **Pull fresh data** — use your connected data sources to gather current state: metrics, decisions, pipeline changes, recent activity.

6. **Draft updates** — compose updated YAML that incorporates approved annotations and fresh data. Use \`get_component_reference\` if you need to check component syntax.

7. **Write the page** — call \`write_page\` with the updated YAML. The site rebuilds automatically.

8. **Mark incorporated** — for each annotation you folded into the page, call \`update_annotation\` with status \`incorporated\`.

9. **Add a summary annotation** — call \`annotate_page\` with \`kind: note\` summarizing what changed and why, so the human reviewer has context.`;

  return `# Curata Agent Instructions

## Connection

MCP Endpoint: ${baseUrl}/api/mcp
Authorization: Bearer ${token}
${slugSection}
## API Format

Every request is a POST to the endpoint with JSON body: \`{ "tool": "<tool_name>", "args": { ... } }\`

Example — read a page:
\`\`\`bash
curl -X POST ${baseUrl}/api/mcp \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${token}" \\
  -d '{"tool": "read_page", "args": {"slug": "${exampleSlug}"}}'
\`\`\`

Example — add an annotation:
\`\`\`bash
curl -X POST ${baseUrl}/api/mcp \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${token}" \\
  -d '{"tool": "annotate_page", "args": {"slug": "${exampleSlug}", "text": "Updated metrics section", "author": "agent", "section": "Key Metrics", "kind": "note"}}'
\`\`\`

Example — write updated page content:
\`\`\`bash
curl -X POST ${baseUrl}/api/mcp \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${token}" \\
  -d '{"tool": "write_page", "args": {"slug": "${exampleSlug}", "content": "<full YAML content>"}}'
\`\`\`

## Available Tools

| Tool | Type | Description |
|------|------|-------------|
| list_pages | read | List all pages in the knowledge base |
| read_page | read | Read a page's YAML, sections, and annotations. Args: \`slug\` |
| write_page | write | Update a page's YAML content and trigger a rebuild. Args: \`slug\`, \`content\` |
| search | read | Full-text search across all pages. Args: \`query\` |
| get_config | read | Get the site configuration. No args. |
| list_annotations | read | List annotations on a page. Args: \`slug\` |
| annotate_page | write | Add an annotation. Args: \`slug\`, \`text\`, \`author\`, \`section\`?, \`target\`?, \`kind\`? (note/edit), \`replacement\`? |
| update_annotation | write | Update annotation status. Args: \`slug\`, \`id\`, \`status\` (approved/incorporated/ignored) |
| get_component_reference | read | Get the kazam component/YAML reference docs. No args. |

## Available Data Sources (use what's connected)

### Email (Gmail / Outlook / Google Calendar)
- Meeting notes, action items, commitments
- Calendar context for timing and stakeholders
- Email threads for decision history

### CRM (HubSpot / Salesforce / Apollo)
- Deal stages, amounts, close dates
- Contact roles and engagement history
- Company firmographics and account status

### Chat (Slack / Teams)
- Channel discussions and decisions
- Shared links and documents
- Team sentiment and blockers

### Ticketing (Linear / Jira)
- Project status and velocity
- Bug counts and resolution times
- Sprint/cycle progress

### Call Tracking (Attention / Granola / Gong)
- Call summaries and key moments
- Objections and commitments
- Sentiment and talk ratios

${workflowSection}

## Guidelines

- Only update sections where you have fresh, reliable data. Leave stale-but-accurate content alone.
- Prefer specific numbers and dates over vague language.
- If data sources conflict, use the most recent signal and note the discrepancy in an annotation.
- Never fabricate metrics. If a data source is unavailable, annotate the gap rather than guessing.
- Keep page structure intact — only change field values, not component types or layout.
`;
}
