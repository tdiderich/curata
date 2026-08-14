---
name: curata-review
description: "Summarize what's waiting on human review in your curata instance: never-trusted pages and pages whose trusted version has fallen behind. Use when asked to 'what needs review', 'curata-review', 'review queue', or 'what's pending trust'."
---

# curata-review

## Building the queue

There is no dedicated review-queue tool over MCP. Build the same picture the dashboard's Review Queue page shows from `list_pages` (or `search_pages`) results, which carry two trust labels per page:

| `trusted` | `trustedBehind` | Meaning |
|-----------|-----------------|---------|
| `false` | `false` | Never trusted - no human has approved any version yet |
| `false` | `true` | Trusted, but behind - an approved version exists, newer edits have superseded it |
| `true` | `false` | Up to date - the trusted version is the latest one |

Call `list_pages` with `channel: "latest"` so you see the real current state of every page, then filter to the first two rows above. That is the review queue.

## Summarizing

Group by "never trusted" and "trusted but behind." Within each group, call out the pages that have gone longest without a look, and skip anything already up to date.

## Showing a diff

`get_versions` on a slug returns the version history (id, author, timestamp) but not content. To see what changed, `read_page` the same slug twice - once with `channel: "trusted"` and once with `channel: "latest"` - and diff the two YAML bodies yourself.

## Marking something trusted

`mark_trusted` (slug, optional version_id, defaults to latest) and `clear_trusted` (slug) are available over MCP, but only call them after the user explicitly confirms they want that specific page (and version) trusted or untrusted right now. Never trust something proactively just because it showed up in a summary.

Eligibility is enforced server-side, same rule as the dashboard's "Mark trusted" button on `/review` (backed by `/api/versions/trust`): if the calling key's human isn't an eligible approver, the tool errors naming the rule instead of trusting anything. When that happens, tell the user what you found and point them at `/review` to do it themselves.

## MCP setup

Requires a curata MCP server exposing `list_pages`, `search_pages`, `read_page`, and `get_versions`. See `/curata-setup` for connection setup.
