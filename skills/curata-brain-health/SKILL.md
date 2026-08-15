---
name: curata-brain-health
description: "Read-only sweep of untagged pages, trusted pages untouched over 90 days, single-page concepts, and likely-duplicate pairs. Publishes one report page that updates in place. Use when asked to 'brain health', 'how healthy is our brain', or 'run a brain health check'."
---

# curata-brain-health

Read the workflow from your curata instance and follow it:

```
read_page slug: "curata-brain-health"
```

The workflow page has the full flow. Follow it step by step.

## Quick reference

- **Read-only sweep.** `list_pages`, `get_vocabulary`, `get_related`, `list_rules`, and `search_pages` - no page gets edited, trusted, or merged by this skill.
- **Four findings:** untagged pages grouped by folder, trusted pages nobody has touched in 90 days, concepts attached to a single page, and likely-duplicate pairs never merged.
- **One report, same slug every run.** `write_page` the brain-health-report page so re-running updates it in place instead of piling up copies.
- **Complements `curata-digest`, doesn't duplicate it.** Digest is the weekly pulse: new pages, trust flips, awaiting review, hot spots. This skill is the slower-moving structural check. Point to `curata-digest` for the weekly read instead of repeating its counts here.
- **Report, don't act.** Name what's untagged, stale, single-use, or duplicated, and hand the list to a human. This skill never trusts, merges, or deletes anything itself.

## MCP setup

Requires a curata MCP server exposing `list_pages`, `get_vocabulary`, `get_related`, `list_rules`, `search_pages`, and `write_page`. See `/curata-setup` for connection setup.
