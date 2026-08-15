---
name: curata-map-org
description: "Read CODEOWNERS files and team directory structure across repos and draft a proposal page for approval groups and folder rules. Propose-only - never creates or updates a group or rule. Use when asked to 'map our org structure', 'propose approval groups', or 'draft groups from codeowners'."
---

# curata-map-org

Read the workflow from your curata instance and follow it:

```
read_page slug: "curata-map-org"
```

The workflow page has the full flow. Follow it step by step.

## Quick reference

- **Read CODEOWNERS and team directories** across the repos this agent can access.
- **Draft one proposal page.** Suggested groups, who belongs in each, and which folders each group should approve.
- **Gate it, then create it.** `create_page` the single proposal page after a human confirms the draft looks right.
- **Never call `create_group`, `update_group`, or `set_rules` from this skill.** Not now, not after the human reviews the proposal. A human owner reads the proposal page and executes it themselves, from the dashboard or the API.
- **This is governance config.** Getting it wrong changes who can approve what across the whole org, so this skill only ever proposes. Nothing here should ever feel like an emergency shortcut around that.

## MCP setup

Requires a curata MCP server exposing `read_page` and `create_page`, plus read access to the org's repos. See `/curata-setup` for connection setup.
