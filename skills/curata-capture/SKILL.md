---
name: curata-capture
description: "Turn a pasted thread, transcript, or conversation into a reviewable curata page: dedup check, checklist, then create or update. Use when asked to 'capture this', 'add to the brain', 'add to the FAQ', or 'save this thread'."
---

# curata-capture

Read the workflow from your curata instance and follow it:

```
read_page slug: "curata-faq-capture"
```

The workflow page has the full choreography - dedup review, checklist, token handling. Follow it step by step.

## Quick reference

- **Get the content.** A pasted thread or transcript needs no setup. If the user gives a link and you already have a tool that can fetch it, use that - otherwise ask them to paste it.
- **Always run `capture_thread` first**, before creating anything. It returns `dedupCandidates` (existing pages that might already cover this), a rule-derived `checklist` for the target page type, and a `captureToken` good for about 15 minutes.
- **Dedup is the user's call when it's ambiguous.** Show them the candidates. Clear match, update it. No match, new page.
- **Fill the checklist from the thread**, and ask the user for whatever's missing - provenance (source link, who said it) especially. Don't invent it.
- **Create:** `create_page` (or `write_page` on a new slug) with `capture_token` and `dedup_ack: "new"`.
- **Update instead:** if `dedup_ack` names a candidate slug, the server rejects the create and tells you to `patch_page` that slug - do that, merging the new answer in rather than duplicating the page.

## MCP setup

Requires a curata MCP server exposing `capture_thread`, `create_page` (or `write_page`), and `patch_page`. See `/curata-setup` for connection setup.
