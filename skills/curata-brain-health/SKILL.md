---
name: curata-brain-health
description: "Read-only sweep of untagged pages, trusted pages untouched over 90 days, single-page concepts, and likely-duplicate pairs. Publishes one report page that updates in place. Use when asked to 'brain health', 'how healthy is our brain', or 'run a brain health check'."
---

# curata-brain-health

Read the workflow from your curata instance and follow it:

```
read_page slug: "curata-brain-health"
```

If the workflow page is missing on your instance, follow this file. It is complete on its own.

## Before you start, ask

- **Which folder** should the report page land in, if the team wants a default rather than picking one each time? Optional, skip if not given.

## Flow

1. **Scan every page.** `list_pages` for folder, trust state (`trusted`/`trustedBehind`), and last-updated date.
2. **Check tags.** `get_related` per page slug. No concepts returned means untagged.
3. **Group untagged pages by folder.**
4. **Find stale trusted pages.** Trusted pages nobody has touched in over 90 days.
5. **Find single-use concepts.** `get_vocabulary` for every concept's `usageCount`. A count of one flags a concept attached to a single page.
6. **Find likely-duplicate pairs.** `search_pages` across titles and concept overlap to spot pairs that look like the same topic and were never merged.
7. **Check governance coverage.** `list_rules` for the folders housing flagged pages, so the report can note whether an existing rule already covers the gap.
8. **Write one report page.** `write_page` the brain-health-report page, same slug every run, so re-running updates it in place instead of piling up copies.
9. **Read-only sweep, no exceptions.** This skill never marks anything trusted, never merges a duplicate pair, and never deletes or renames a concept. It names the finding and hands the report to a human.
10. **Don't repeat curata-digest's job.** Digest is the weekly pulse: new pages, trust flips, awaiting review, hot spots. This skill is the slower-moving structural check. Point to `curata-digest` for the weekly read instead of repeating its counts here.

## MCP setup

Requires a curata MCP server exposing `list_pages`, `get_vocabulary`, `get_related`, `list_rules`, `search_pages`, and `write_page`. See `/curata-setup` for connection setup.
