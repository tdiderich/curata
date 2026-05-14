# @curata/mcp-server

> **Note:** curata now includes a built-in MCP server via SSE. You no longer need this package. Just point your MCP client at `http://your-curata-url/api/mcp/stream`. This package is kept for backward compatibility with stdio-only MCP clients.

MCP server for [curata](https://curata.ai) — connect your AI agents to your team's knowledge base.

## Install

Install from the repo:

```bash
cd packages/mcp-server
npm install
npm run build
npm link
```

> Once published to npm, you'll be able to install via `npm install -g @curata/mcp-server`.

## Setup

1. Get an API key from your curata dashboard: **Settings > API Keys**
2. Add to your MCP client config:

### Claude Code / Claude Desktop

Add to `~/.claude.json` (or `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "curata": {
      "command": "curata-mcp",
      "env": {
        "CURATA_API_KEY": "ck_your_api_key_here"
      }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "curata": {
      "command": "curata-mcp",
      "env": {
        "CURATA_API_KEY": "ck_your_api_key_here"
      }
    }
  }
}
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CURATA_API_KEY` | Yes | — | Your curata API key (starts with `ck_`) |
| `CURATA_URL` | No | `https://curata.ai` | Base URL of your curata instance |

## Tools

| Tool | Description |
|------|-------------|
| `search_pages` | Search your team's knowledge base by keywords or topics |
| `read_page` | Read a specific page by slug — returns YAML content, sections, and annotations |
| `list_pages` | List all pages with titles, slugs, and metadata |
| `write_page` | Create or update a page. Provide a title and YAML content — the slug is auto-generated from the title |
| `create_page` | Create a new page (fails if slug already exists) |
| `annotate_page` | Add an annotation to a page — observations, suggestions, or edit proposals |

## Example Usage

Once configured, your AI agent can:

```
Search for "revenue" in the knowledge base
→ search_pages(query: "revenue")

Read the Q2 report
→ read_page(slug: "q2-revenue-analysis")

Write a new research summary
→ write_page(title: "Competitor Analysis Q2", content: "title: Competitor Analysis Q2\nshell: document\n...")

Add a note to a page
→ annotate_page(slug: "q2-revenue-analysis", text: "Revenue figures updated from latest CRM data", kind: "note")
```

## The Knowledge Loop

curata closes the knowledge loop for AI-forward teams:

1. **Agents write** — your AI tools write structured knowledge to curata via MCP
2. **Humans curate** — your team reviews, annotates, and organizes in a readable dashboard
3. **Agents read** — future agent sessions search and read from the shared knowledge base

Agent outputs become agent inputs. The loop compounds.
