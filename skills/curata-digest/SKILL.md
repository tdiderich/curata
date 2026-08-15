---
name: curata-digest
description: "Generate this org's brain digest: new pages, trust flips, what's awaiting review, and hot spots since the last run. Use when asked to 'run the digest', 'what changed this week', 'brain digest', or on a weekly cadence."
---

# curata-digest

## Running it

Call `generate_digest`. It takes no arguments. The server computes the window (since the last digest run, or the last 7 days the first time), gathers the data, and writes a dated page to the Digests folder - `digest-YYYY-Www` (ISO week). Running it again in the same week updates that same page instead of creating a duplicate, so it is safe to re-run.

The result carries `slug`, `folderId`, `created`, `windowStart`, `windowEnd`, and a `summary` with counts for each section. `read_page` the returned slug to see the full page.

## Cadence

Weekly is the default guidance, not an enforced schedule. Run it:

- On a weekly cadence (before a standup or Monday morning), or
- Whenever a human asks what changed since the last check-in.

Nothing forces the interval. If a human asks for a digest mid-week, run it - the window just covers however long it has been since the last one.

## What is in it

Five sections, always present even when a section is empty:

- **Overview** - the date range covered and a one-line count of everything below.
- **New pages** - pages created in the window, grouped by concept tag. Untagged pages land in their own group.
- **Trust flips** - pages a human marked trusted in the window, who did it, and when.
- **Awaiting review** - pages where a trusted version exists but newer edits have moved ahead of it. This is not the same as never-trusted pages; run `curata-review` for the full review queue picture.
- **Hot spots** - pages edited more than once in the window, most-edited first.

Every entry links back to its page slug.

## Summarizing to a human

Lead with counts from the `summary` the tool returns, then read the page for the entries themselves. Keep it short: which tags got new pages, who flipped what to trusted, what is still waiting, and which pages are getting hammered with edits. If awaiting review is non-empty and growing week over week, say so - that is a backlog forming, not just a line item.

## MCP setup

Requires a curata MCP server exposing `generate_digest` and `read_page`. See `/curata-setup` for connection setup.
