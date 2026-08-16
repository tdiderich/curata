---
name: curata-digest
description: "Generate this org's brain digest: one big thing, a few noteworthy items, and activity stats since the last run. Use when asked to 'run the digest', 'what changed this week', 'brain digest', or on a weekly cadence."
---

# curata-digest

## Running it

1. Call `generate_digest {preview: true}`. This returns the gathered window data (no page is written): `windowStart`, `windowEnd`, the `slug` this run would write, `newPageCount`/`taggedNewPageCount`, new page refs grouped by concept, `trustFlips`, `awaitingReview`, and `hotSpots`.
2. Read the top changed pages with `read_page` - hot spots first, then new pages with meaningful titles - enough to judge substance, typically 3-6 pages.
3. Draft 2-4 "One big thing" candidates (a short headline plus a one-line why) and 2-3 noteworthy items (a 2-5 word summary and one concise sentence each, with the page slug behind each).
4. GATE - present the candidates to the human in chat, numbered, and ask them to pick one or supply their own. Do not write the page until they answer. This gate is the whole point of the flow: the human picks the final "One big thing," not the agent.
5. Call `generate_digest` again, this time with `big_thing` (the human's pick, no `also_considered`) and `noteworthy` (the short list, max 3 items).
6. Unattended runs only (cron jobs, or a human explicitly says "run it without me"): skip the gate, pass your own top candidate as `big_thing`, and set `also_considered` to the other candidates' headlines so the human can see what else was in the running when they read the page.
7. Keep tagging pages you write with concepts, same as everywhere else in this brain.

## Cadence

Weekly is the default guidance, not an enforced schedule. Run it:

- On a weekly cadence (before a standup or Monday morning), or
- Whenever a human asks what changed since the last check-in.

Nothing forces the interval. If a human asks for a digest mid-week, run it - the window just covers however long it has been since the last one.

## What is in it

Three sections:

- **One big thing** - the week's single biggest item: a short headline, one to three sentences of body, and a link to the page behind it when there is one. Only renders when a pick was supplied.
- **Noteworthy** - 2-3 shorter items, each a bold summary plus one sentence, linked to its page for the full read. Only renders when items were supplied.
- **Activity** - always present. A stats line (new pages and how many are tagged, trust flips, pages awaiting review, hot spots) and, when there are hot spots, a line naming the most-edited pages.

A page generated with `preview: true` skipped, or generated with neither `big_thing` nor `noteworthy` supplied, shows Activity only - that is expected, not broken.

The stats line reports tagging health directly: when it says 0 tagged, grouping had nothing to work with - relay that to the human as an action item, since digest quality tracks tagging discipline directly.

## Reading digests later

Digest pages are system reports, so no human marks them trusted. Read them by slug (`digest-<year>-w<week>`) or with `channel: "latest"` - a trusted-channel search will not surface them, and that is expected, since trusted stays reserved for human-approved knowledge.

## Summarizing to a human

Lead with the "One big thing" pick, then the noteworthy items, then the activity stats. Keep it short. If awaiting review is non-empty and growing week over week, say so - that is a backlog forming, not just a line item.

## MCP setup

Requires a curata MCP server exposing `generate_digest`, `read_page`, and `list_pages`. See `/curata-setup` for connection setup.
