---
name: curata-setup
description: "Configure the curata MCP connection for this project. Asks cloud vs self-hosted, writes .mcp.json, tests the connection. Use when asked to 'set up curata', 'connect curata', 'curata-setup', or when other curata skills fail because no MCP server is configured."
allowed-tools: AskUserQuestion, Read, Write, Edit, Bash, ToolSearch
---

# curata-setup

Connect this project to a curata instance.

## Step 1: Check existing config

Read `.mcp.json` in the project root. If a curata server is already configured, tell the user and ask if they want to reconfigure. If not, proceed.

## Step 2: Ask deployment type

Ask the user:

> **How is your curata instance deployed?**
>
> 1. **curata.ai (cloud)** — hosted at curata.ai
> 2. **Self-hosted** — running on your own infrastructure
> 3. **Local dev** — running locally (localhost)

Map answers to base URLs:
- Cloud: `https://curata.ai`
- Self-hosted: ask for the URL (e.g. `https://curata.internal.company.com`)
- Local dev: `http://localhost:3000`

## Step 3: Ask for auth

If cloud or self-hosted:

> **Paste your curata API key** (starts with `ck_`). You can create one at Settings → API Keys in your dashboard.

Store the key as an environment variable reference, NOT the raw key:

- Ask what env var name they want (default: `CURATA_API_KEY`)
- Write the `.mcp.json` with `${ENV_VAR_NAME}` placeholder
- Remind them to add the actual key to their `.env` or shell profile

If local dev with no auth (`AUTH_MODE=none`): skip the auth block entirely.

## Step 4: Write .mcp.json

If `.mcp.json` exists, merge the curata server into it. If not, create it.

**Cloud / self-hosted (with auth):**

```json
{
  "mcpServers": {
    "curata": {
      "type": "url",
      "url": "{base_url}/api/mcp/stream",
      "headers": {
        "Authorization": "Bearer ${CURATA_API_KEY}"
      }
    }
  }
}
```

**Local dev (no auth):**

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

The MCP server name MUST be `curata` — other curata skills depend on this name.

## Step 5: Test the connection

Tell the user:

> Restart your editor or reload MCP config, then ask me to `list pages` to verify the connection works.

Do NOT attempt to call curata MCP tools in this same session — the config was just written and needs a reload to take effect.

## Step 6: Confirm

Print:

```
curata MCP configured:
  Instance: {base_url}
  Auth: {env_var_name} (add to .env or shell profile)
  Config: .mcp.json

Available skills: /curata-plan, /curata-workflow, /curata-read, /curata-write
```
