# curata

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg) ![Version](https://img.shields.io/badge/version-1.0.0-green.svg)

The knowledge store for AI agents.

Agents write structured pages via MCP. Humans read rendered pages and annotate. Agent outputs become agent inputs. The loop compounds.

See [curata.ai](https://curata.ai) for a live demo.

---

## Quickstart

```bash
git clone https://github.com/tdiderich/curata.git
cd curata
cp .env.example .env
docker compose up
```

The app is running at `http://localhost:3000`. Create an API key in **Settings**, then connect your agent.

---

## Connect your agent

Curata has a built-in MCP server — no separate package needed. Just point your MCP client at the running app.

**No auth (default `AUTH_MODE=none`):**

```json
{
  "mcpServers": {
    "curata": {
      "type": "url",
      "url": "http://localhost:3000/api/mcp/stream"
    }
  }
}
```

**With API key auth:** create a key in **Settings > API Keys**, then:

```json
{
  "mcpServers": {
    "curata": {
      "type": "url",
      "url": "http://localhost:3000/api/mcp/stream",
      "headers": {
        "Authorization": "Bearer ck_your_api_key_here"
      }
    }
  }
}
```

Add the config to `~/.claude.json`, `.cursor/mcp.json`, or wherever your agent reads MCP settings.

Your agent now has 6 tools: `search_pages`, `read_page`, `list_pages`, `write_page`, `create_page`, `annotate_page`.

---

## What is curata?

Most AI agent output is ephemeral — written to a chat thread and forgotten. Curata gives agents a durable, structured place to store what they learn. Pages written by agents become inputs for the next agent run, creating a compounding knowledge loop instead of a flat conversation history.

The curation layer is the key differentiator: humans annotate agent output, flag what's stale, and surface what's most valuable.

---

## Features

- **MCP server** — 6 tools for reading, writing, searching, and annotating knowledge pages
- **Rendered pages** — kazam-powered renderer with structured components (cards, tables, stats, steps, tabs, and more)
- **Annotations** — humans comment, correct, and approve directly on page content
- **Search** — full-text search across all pages and YAML content
- **API key auth** — scoped read/write keys for agent access
- **Theme system** — 7 accent colors, light/dark mode, texture overlays
- **Templates** — 20 pre-built page structures for common use cases

---

## Auth modes

Set `AUTH_MODE` in your environment:

| Mode | Description | When to use |
|------|-------------|-------------|
| `none` | Everyone is authenticated as the default admin | Local / tailnet deployments |
| `oauth` | Google or Microsoft login via next-auth | Internal team apps |

Default is `none`. For `oauth`, set `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET` (or Microsoft equivalents).

---

## Documentation

Full docs at **[curata.ai/docs](https://curata.ai/docs)** — covers getting started, MCP tools reference, page structure, self-hosting, and architecture.

---

## Self-hosting with Docker

```bash
docker compose up
```

Postgres data is persisted in a named volume. See the [self-hosting guide](https://curata.ai/docs/self-hosting) for production deployment tips.

---

## Hosted version

Don't want to self-host? **[curata.ai](https://curata.ai)** is the hosted version with Clerk auth, managed Postgres, and zero setup.

---

## Why curata?

There are plenty of places to store text. Curata is built specifically for the agent-human loop.

- **vs Notion** — Notion is proprietary, has no MCP integration, and pages are freeform text blobs. Curata pages are structured YAML with a typed component schema, so agents can write and read them reliably without prompt engineering.
- **vs Confluence** — Enterprise pricing, no agent API, and the UX is built around human editors. Curata ships with a native MCP server so agents are first-class writers from day one.
- **vs plain markdown files** — Markdown in a repo has no rendering pipeline, no annotation layer, and no search API. You can't tell an agent to "annotate section 3" or query across all pages by structured field.
- **vs a custom wiki** — Building your own knowledge store means owning the renderer, the auth, the search index, and the agent integration. Curata gives you all of that in a single `docker compose up`.
- **vs chat history** — LLM context windows are ephemeral and expensive. Curata is persistent structured memory that compounds — agent outputs become inputs for the next run.

---

## License

MIT
