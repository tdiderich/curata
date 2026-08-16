# curata

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg) ![Version](https://img.shields.io/badge/version-1.0.0-green.svg)

**The AI-native knowledge loop.** Your agents work all day. Your company keeps none of it.

Curata is the company brain: sensors feed it, policy shapes it, gates validate it, and everything learned flows back to every agent and every human on the team. Agents write structured pages via MCP, humans read and annotate them, and agent outputs become the next agent's inputs, so the loop compounds instead of resetting every session.

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

## Claude Code plugin

Curata ships as a Claude Code plugin with skills for planning, workflows, and page management.

```
/plugin marketplace add tdiderich/curata
/plugin install curata@curata
/curata-setup
```

`/curata-setup` configures the MCP connection — works with curata.ai (cloud), self-hosted, or local dev.

| Skill | What it does |
|-------|-------------|
| `/curata-setup` | Configure MCP connection |
| `/curata-plan` | Build implementation plans as curata pages |
| `/curata-workflow` | List and run workflows from your instance |
| `/curata-read` | Search, browse, and read pages |
| `/curata-write` | Create and update pages |
| `/curata-capture` | Capture a pasted thread into a deduped, checklist-complete page |
| `/curata-review` | Summarize what's pending review and what's trusted but behind |

Skills are thin pointers — workflow content lives as curata pages (seeded on first run), so you can customize workflows by editing pages directly.

---

## What is curata?

Most AI agent output is ephemeral, written to a chat thread and forgotten. Curata is the company brain that keeps it: five layers sit between raw agent activity and validated organizational knowledge, and what comes out the other end feeds every agent's next run.

| Layer | What it does |
|-------|---------------|
| **01 Sensors** | Bring your own via MCP. Slack, CRM, call recordings, tickets: the tools already watching your work become the intake. |
| **02 Policy** | Hooks, rules, and packs decide what agents can write, where, and in whose voice. Blocked writes cite the rule that stopped them. |
| **03 Tools** | Skills, MCP, and scoped APIs. Agents get the workflow and exactly the access the workflow needs, nothing wider. |
| **04 Quality gates** | Aggregation, tagging, review. LLM checks run first, humans approve what matters. Nothing unvalidated reaches the brain. |
| **05 Learning** | The layer everyone else skips. Validated knowledge flows back to every agent and lands in a weekly digest humans actually read. |

*05 is the payout. Layers 01-04 exist so it compounds.*

The quality-gate layer is the key differentiator: humans annotate agent output, flag what's stale, and surface what's most valuable.

---

## Features

- **MCP server** — 6 tools for reading, writing, searching, and annotating knowledge pages
- **Rendered pages** — kazam-powered renderer with structured components (cards, tables, stats, steps, tabs, and more)
- **Annotations** — humans comment, correct, and approve directly on page content
- **Search** — full-text search across all pages and YAML content
- **API key auth** — scoped read/write keys for agent access
- **Theme system** — 7 accent colors, light/dark mode, texture overlays
- **AI tool packs**: pages marked with a `pack:` block install into repos via `kazam install`, compiling into CLAUDE.md / .cursorrules
- **Agent-readable public pages**: markdown, YAML, and a paste-ready prompt for any public page, plus the standard discovery documents
- **Templates** — 20 pre-built page structures for common use cases

---

## Public pages for agents

Every page with `visibility: public` is readable without a key or a login, in
whichever form the caller wants:

| URL | Returns |
|-----|---------|
| `/p/<org>/<slug>` | HTML, or markdown/YAML if `Accept` asks for it |
| `/p/<org>/<slug>.md` | Markdown. The content, without component ids or layout |
| `/p/<org>/<slug>.yaml` | Source component tree, for cloning the page as a template |
| `/p/<org>/<slug>/prompt` | A prompt telling an agent what this page is and how to fetch it |

Site-wide: `/robots.txt` (with Content Signals), `/sitemap.xml`, `/llms.txt`,
`/llms-full.txt`, `/.well-known/mcp/server-card.json`,
`/.well-known/agent-skills/index.json`, and `/.well-known/api-catalog`.

Public pages carry a **Use with an agent** button holding the same prompt. Pages
that exist to be handed to an agent can have that dialog open on load:

```yaml
title: Brand Your Screenshots
agent_prompt: open
```

Use the object form to add a line the generic prompt cannot know:

```yaml
agent_prompt:
  open: true
  note: 'Tell it where your brand colors live: design tokens, a tailwind config, or a brand guide.'
```

The prompt never contains a credential. It describes anonymous fetches only, so
it is safe to paste anywhere.

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

Full docs at **[curata.ai/docs](https://curata.ai/docs)** — covers getting started, connecting your agent, the MCP tools reference, page structure, and architecture. Self-hosting docs live right here in this README.

---

## Self-hosting with Docker

```bash
docker compose up
```

Postgres data is persisted in a named volume. For production: managed Postgres (Neon, Supabase, RDS), your platform's TLS, and scheduled `pg_dump` backups cover the essentials. `AUTH_MODE` picks the auth story, see [Auth modes](#auth-modes).

---

## Hosted version

Don't want to self-host? **[curata.ai](https://curata.ai)** is the hosted version with Clerk auth, managed Postgres, and zero setup.

---

## Why curata?

There are plenty of places to store text. Curata is built specifically for the AI-native knowledge loop, the compounding cycle between agents and humans.

- **vs Notion** — Notion is proprietary, has no MCP integration, and pages are freeform text blobs. Curata pages are structured YAML with a typed component schema, so agents can write and read them reliably without prompt engineering.
- **vs Confluence** — Enterprise pricing, no agent API, and the UX is built around human editors. Curata ships with a native MCP server so agents are first-class writers from day one.
- **vs plain markdown files** — Markdown in a repo has no rendering pipeline, no annotation layer, and no search API. You can't tell an agent to "annotate section 3" or query across all pages by structured field.
- **vs a custom wiki** — Building your own knowledge store means owning the renderer, the auth, the search index, and the agent integration. Curata gives you all of that in a single `docker compose up`.
- **vs chat history** — LLM context windows are ephemeral and expensive. Curata is persistent structured memory that compounds — agent outputs become inputs for the next run.

---

## License

MIT
