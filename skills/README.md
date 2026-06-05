# curata Claude Code Plugin

Skills for managing your curata instance from Claude Code, Cursor, or any MCP-compatible agent.

## Skills

| Skill | Trigger | What it does |
|-------|---------|-------------|
| `curata-setup` | `/curata-setup` | Configure the MCP connection (cloud, self-hosted, or local) |
| `curata-plan` | `/curata-plan` | Build implementation plans as curata pages |
| `curata-workflow` | `/curata-workflow` | List and run workflows from your curata instance |
| `curata-read` | `/curata-read` | Read, search, and browse pages |
| `curata-write` | `/curata-write` | Create and update pages |

## Getting started

```
/plugin marketplace add tdiderich/curata
/plugin install curata@curata
/curata-setup
```

## How it works

Skills are thin pointers — they tell the agent to read a workflow page from your curata instance and follow it. The actual workflow content lives as curata pages (seeded on first run), so you can customize workflows by editing pages directly.

## Install

```
/plugin marketplace add tdiderich/curata
/plugin install curata@curata
```

Then run `/curata-setup` to configure cloud, self-hosted, or local dev connection.
