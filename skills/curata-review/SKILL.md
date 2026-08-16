---
name: curata-review
description: "Summarize what's waiting on human review in your curata instance: never-trusted pages and pages whose trusted version has fallen behind. Use when asked to 'what needs review', 'curata-review', 'review queue', or 'what's pending trust'."
---

# curata-review

## Building the queue

`get_review_queue` returns the same rules-scoped queue the dashboard's Review Queue page shows: never-trusted pages where an approval rule applies to their scope, plus any page whose trusted version has fallen behind latest. Locked folders never appear. Each row carries slug, title, folder name, neverTrusted, versionsBehind, the trusted and latest version ids, and the applicable approval rule description if one resolves. Call it directly rather than reconstructing the queue by hand.

If you only have `list_pages` (or `search_pages`) results to work from, the same picture is recoverable from the two trust labels every page carries:

| `trusted` | `trustedBehind` | Meaning |
|-----------|-----------------|---------|
| `false` | `false` | Never trusted - no human has approved any version yet |
| `false` | `true` | Trusted, but behind - an approved version exists, newer edits have superseded it |
| `true` | `false` | Up to date - the trusted version is the latest one |

Call `list_pages` with `channel: "latest"` so you see the real current state of every page, then filter to the first two rows above. That is the fallback path when `get_review_queue` isn't available.

## Summarizing

Group by "never trusted" and "trusted but behind." Within each group, call out the pages that have gone longest without a look, and skip anything already up to date.

## Showing a diff

`get_versions` on a slug returns the version history (id, author, timestamp) but not content. To see what changed, `read_page` the same slug twice - once with `channel: "trusted"` and once with `channel: "latest"` - and diff the two YAML bodies yourself.

## Marking something trusted

`mark_trusted` (slug, optional version_id, defaults to latest) and `clear_trusted` (slug) are available over MCP, but only call them after the user explicitly confirms they want that specific page (and version) trusted or untrusted right now. Never trust something proactively just because it showed up in a summary.

Eligibility is enforced server-side, same rule as the dashboard's "Mark trusted" button on `/review` (backed by `/api/versions/trust`): if the calling key's human isn't an eligible approver, the tool errors naming the rule instead of trusting anything. When that happens, tell the user what you found and point them at `/review` to do it themselves.

## Pre-screen

A pre-screen is you working the queue before a human does, so their review time goes to judgment calls instead of first-pass reading. Trigger phrases: "pre-screen the review queue," "screen the queue," "check the queue for issues."

Flow, one item at a time:

1. `get_review_queue` for the full list.
2. For each item, read both channels: `read_page` with `channel: "trusted"` and again with `channel: "latest"`, then diff them yourself. A never-trusted page has no trusted channel content to compare against, so the latest read is the whole diff.
3. `list_rules` for the item's folder and check the edit against every rule in the cascade (global, folder, page).
4. `search_pages` plus `get_related` on the page's topic to check whether this looks like a duplicate of an existing page.
5. `validate_page` to catch structural problems (missing required components, broken shell, malformed YAML).
6. `annotate_page` one note per real finding: a rule violation, a likely duplicate of a named slug, a structural problem, or (when nothing turned up) a single "clean - only routine edits" note so the human knows this one was actually screened, not skipped. Use `kind: "note"` and `source: "prescreen"` so the note is distinguishable from a normal agent annotation in `list_annotations`/`list_open_annotations`.
7. When every item is screened, summarize for the human: how many items, how many carried findings, and which ones need their attention first.

Guardrails, no exceptions:

- Never call `mark_trusted` or `clear_trusted` during a pre-screen. Findings are advisory, the trust decision stays with a human.
- Never edit the page (no `write_page`, `patch_page`, `replace_in_page`) to fix what you found. Annotate it and move on.
- If `get_review_queue` comes back empty, say so and stop, there is nothing to screen.

This works with whatever model the connected agent is running, curata never makes its own server-side calls to screen anything.

## MCP setup

Requires a curata MCP server exposing `list_pages`, `search_pages`, `read_page`, `get_versions`, and `get_review_queue`. See `/curata-setup` for connection setup.
