---
name: curata-import-wiki
description: "Walk an exported wiki directory (Notion, Confluence, or GitBook export on disk) and propose its pages as reviewable curata pages, flagging stale content instead of copying it blind. Use when asked to 'import our wiki', 'bring in the notion export', or 'load the confluence export into curata'."
---

# curata-import-wiki

Read the workflow from your curata instance and follow it:

```
read_page slug: "curata-import-wiki"
```

If the workflow page is missing on your instance, follow this file. It is complete on its own.

## Before you start, ask

- **Where is the exported wiki directory on disk?** Notion, Confluence, and GitBook exports all work. Ask for the path if it isn't given.
- **Which folder** should imported pages land in, if the team wants a default rather than picking one each time? Optional, skip if not given.

## Flow

1. **Walk the export directory page by page.** Every page in the export gets a turn.
2. **Check content rules before the first write.** Call `list_rules` (or `get_config`) once, before drafting anything, so the content you write already fits the org's blocking rules instead of getting rejected on the first attempt.
3. **Check each page for staleness as you read it.** Old dates, dead product names, or a claim that contradicts an already-trusted page. Note it, don't drop it and don't copy it blind.
4. **Run `capture_thread` on the next export page.** Always, every page, no exceptions. It returns `dedupCandidates` against the existing brain, a checklist, and a `captureToken`.
5. **Show the human the `dedupCandidates`.** Stop and wait. Do not call `create_page` or `write_page` until a human has looked at the candidates and told you which way to go.
6. **Write only after the human decides.** A clear match: `patch_page` the matched slug. No match: `create_page` with `capture_token` and `dedup_ack: "new"`.
7. **Re-run `capture_thread` immediately before each write, not once for the whole batch.** The `capture_token` expires. If any time passes between minting it and writing (showing the human the candidates, waiting on a decision, moving to the next export page), call `capture_thread` again right before the write instead of reusing a token that may have gone stale.
8. **Tag every page** with at least one concept so it surfaces in the brain map.
9. **Everything lands untrusted.** This skill never marks a page trusted. A human reviews and trusts from `/review`.
10. **Summarize at the end.** How many pages found, how many proposed as new, how many merged into existing pages, how many skipped, and how many flagged as stale.

## MCP setup

Requires a curata MCP server exposing `capture_thread`, `create_page` (or `write_page`), `patch_page`, and `list_rules`, plus read access to the exported wiki directory. See `/curata-setup` for connection setup.
