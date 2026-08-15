---
name: curata-map-org
description: "Read CODEOWNERS files and team directory structure across repos and draft a proposal page for approval groups and folder rules. Propose-only - never creates or updates a group or rule. Use when asked to 'map our org structure', 'propose approval groups', or 'draft groups from codeowners'."
---

# curata-map-org

Read the workflow from your curata instance and follow it:

```
read_page slug: "curata-map-org"
```

If the workflow page is missing on your instance, follow this file. It is complete on its own.

## Before you start, ask

- **Which repos** should this skill read CODEOWNERS and team directories from? Name them, or confirm "everything this agent has access to."
- **Which folder** should the proposal page land in, if the team wants a default rather than picking one each time? Optional, skip if not given.

## Flow

1. **Read CODEOWNERS and team directory structure** across the repos scoped above.
2. **If a repo has no CODEOWNERS file and no team directory structure, flag the gap and propose nothing for that repo.** Never guess who owns what from file paths, commit history, or naming conventions. A missing CODEOWNERS file is a finding to report, not a gap to fill in with a guess.
3. **Never treat seed content, demo content, or template placeholders as team data.** Anything under this instance's `seed/` or `demos/` directories, a fictional example org chart, a template's placeholder team roster, or any other stand-in content is not a real team and does not belong in the proposal. If a repo's own docs contain obvious placeholder or example org structure, skip it the same way.
4. **Check what's already documented.** `read_page` any existing groups or approval rules already written up in curata, so the proposal doesn't repeat what's already set up.
5. **Draft one proposal page.** Suggested groups, who belongs in each (from real CODEOWNERS and team directory data only), and which folders each group should approve.
6. **Stop and wait for a human to approve the draft before writing anything.** Do not call `create_page` until a human has reviewed the proposal and confirmed it looks right.
7. **Write the single proposal page** with `create_page` after that approval, and stop there.
8. **Never call `create_group`, `update_group`, or `set_rules` from this skill.** Not now, not after the human reviews the proposal. A human owner reads the proposal page and executes it themselves, from the dashboard or the API.

## This is governance config

Getting it wrong changes who can approve what across the whole org, so this skill only ever proposes. Nothing here should ever feel like a shortcut around a human decision.

## MCP setup

Requires a curata MCP server exposing `read_page` and `create_page`, plus read access to the org's repos. See `/curata-setup` for connection setup.
