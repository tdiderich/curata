---
name: curata-plan
description: "Create, update, and track implementation plans as curata pages. Runs forcing questions, builds before/after view, produces phased task breakdown. Use when asked to 'plan', 'create a plan', 'curata-plan', or 'make a plan page'."
---

# curata-plan

Read the workflow from your curata instance and follow it:

```
read_page slug: "workflow-implementation-planning"
```

The workflow page has the full process — forcing questions, component patterns, anti-patterns, and update instructions. Follow it step by step.

## Quick reference

- **Slug convention:** `plan-{kebab-case-description}`
- **Plans folder:** look up via `list_pages` or use folder_id if configured in your project's CLAUDE.md
- **Create:** `create_page` with slug and YAML content
- **Update progress:** `read_page` → update tree node statuses → `write_page`

## MCP setup

This skill requires a curata MCP server. Add to `.mcp.json`:

```json
{
  "mcpServers": {
    "curata": {
      "type": "url",
      "url": "https://your-instance.curata.ai/api/mcp/stream",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```
