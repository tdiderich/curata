---
name: curata-read
description: "Read pages, search, and browse your curata instance. Use when asked to 'check curata', 'read from curata', 'search curata', 'what's in curata', or 'find the page about X'."
---

# curata-read

## Tools

| Tool | Use for |
|------|---------|
| `list_pages` | Browse all pages |
| `read_page` | Read a specific page by slug |
| `search_pages` | Full-text keyword search |

## Common patterns

- "What plans do we have?" → `search_pages` query: "plan"
- "Read the deploy plan" → `read_page` slug: "plan-deploy-hardening"
- "What workflows exist?" → `search_pages` query: "workflow"
- "Show me everything" → `list_pages`

Page content is YAML with `title`, `shell`, and `components`. Annotations (comments, suggestions) appear alongside the page content when you read it.
