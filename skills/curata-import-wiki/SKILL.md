---
name: curata-import-wiki
description: "Walk an exported wiki directory (Notion, Confluence, or GitBook export on disk) and propose its pages as reviewable curata pages, flagging stale content instead of copying it blind. Use when asked to 'import our wiki', 'bring in the notion export', or 'load the confluence export into curata'."
---

# curata-import-wiki

Read the workflow from your curata instance and follow it:

```
read_page slug: "curata-import-wiki"
```

The workflow page has the full choreography - the capture flow per export page, the staleness checks, and the end-of-run summary. Follow it step by step.

## Quick reference

- **Get the export directory.** Notion, Confluence, and GitBook exports on disk all work. Ask for the path if it isn't given.
- **Walk it page by page.** Each export page runs through the same capture choreography as a pasted thread.
- **Run `capture_thread` first, always.** It returns `dedupCandidates` against the existing brain, a checklist, and a `captureToken`. Clear match, `patch_page` it. No match, new page with `capture_token` and `dedup_ack: "new"`.
- **Flag what looks stale, don't copy it blind.** Old dates, dead product names, or content that contradicts an already-trusted page goes in a stale-content section of the summary instead of getting written as-is.
- **Everything lands untrusted.** This skill never marks a page trusted. A human reviews and trusts from `/review`.
- **Tag every page** with at least one concept so it surfaces in the brain map.
- **Summarize at the end.** How many pages found, how many proposed as new, how many merged into existing pages, how many skipped, and how many flagged as stale.

## MCP setup

Requires a curata MCP server exposing `capture_thread`, `create_page` (or `write_page`), and `patch_page`, plus read access to the exported wiki directory. See `/curata-setup` for connection setup.
