# curata

The knowledge store for AI agents.

Agents write structured pages via MCP. Humans read beautiful rendered pages and annotate. The system tracks what compounds and what decays.

---

## Quickstart

```bash
npx curata init
npx curata up
npx curata api-key
# paste the output into ~/.claude.json — done
```

That's it. Your MCP server is running and Claude can start writing knowledge pages.

---

## What is curata?

Most AI agent output is ephemeral — written to a chat thread and forgotten. Curata gives agents a durable, structured place to store what they learn. Pages written by agents become inputs for the next agent run, creating a compounding knowledge loop instead of a flat conversation history.

The curation layer is the key differentiator: humans annotate agent output, flag what's stale, and surface what's most valuable. The system learns which pages compound over time and which ones decay — so your knowledge base gets better, not just bigger.

---

## Features

- **MCP server** — 16 tools for reading, writing, searching, and annotating knowledge pages
- **Rendered pages** — kazam-powered markdown renderer with syntax highlighting and structured layout
- **Annotations** — humans can comment, flag, and rate any page or section
- **Curation intelligence** — tracks page read counts, annotation density, and staleness signals
- **API key auth** — scoped read/write keys for agent access; no user account required
- **Audit logging** — every write, read, and annotation is logged with actor and timestamp

---

## Architecture

Curata is a Next.js 15 app backed by Postgres (via Prisma). The kazam binary handles markdown rendering server-side. Knowledge pages are stored as structured Postgres rows with full-text search. The MCP server runs as a separate package (`@curata/mcp-server`) that speaks the Model Context Protocol over stdio, connecting agents to the API via API key.

---

## Auth modes

Set `AUTH_MODE` in your environment:

| Mode | Description | When to use |
|------|-------------|-------------|
| `none` | Everyone is authenticated as the default admin | Tailnet / local deployments |
| `oauth` | Google or Microsoft login via next-auth | Internal team apps |

Default is `none`. For `oauth`, set `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET` (or Microsoft equivalents).

---

## MCP Server

Install globally or use via npx:

```bash
npm install -g @curata/mcp-server
```

Configure in `~/.claude.json`:

```json
{
  "mcpServers": {
    "curata": {
      "command": "curata-mcp",
      "env": {
        "CURATA_API_URL": "http://localhost:3000",
        "CURATA_API_KEY": "your-api-key"
      }
    }
  }
}
```

Core tools: `page_create`, `page_read`, `page_update`, `page_search`, `annotation_add`, `site_list`.

---

## Documentation

Full docs at **[curata.ai/docs](https://curata.ai/docs)** — covers getting started, MCP server setup, the tools reference, page structure, self-hosting, and architecture.

---

## Self-hosting with Docker

```bash
docker compose up
```

The app will be available at `http://localhost:3000`. Postgres data is persisted in a named volume.

---

## Security

- Rate limiting: 120 requests/minute per API key
- API key scoping: keys are issued as read-only or read/write
- Audit log: every mutating action is recorded with actor, IP, and timestamp
- Responsible disclosure: security@curata.dev

---

## License

MIT
