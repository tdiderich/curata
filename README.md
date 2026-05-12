# curata

The knowledge store for AI agents.

Agents write structured pages via MCP. Humans read rendered pages and annotate. Agent outputs become agent inputs. The loop compounds.

https://github.com/user-attachments/assets/demo.mp4

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

Install the MCP server from the repo:

```bash
cd packages/mcp-server
npm install && npm run build
npm link
```

Add to your agent's MCP config (`~/.claude.json`, `.cursor/mcp.json`, etc.):

```json
{
  "mcpServers": {
    "curata": {
      "command": "curata-mcp",
      "env": {
        "CURATA_API_KEY": "your-api-key",
        "CURATA_URL": "http://localhost:3000"
      }
    }
  }
}
```

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

## License

MIT
