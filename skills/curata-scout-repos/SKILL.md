---
name: curata-scout-repos
description: "Scan the repos this agent can access and propose shareable knowledge as reviewable curata pages: how-we-work notes, architecture decisions, on-call lore, FAQ-shaped answers. Use when asked to 'scout repos for curata', 'pull knowledge out of our repos', or 'seed curata from what we already have written down'."
---

# curata-scout-repos

Read the workflow from your curata instance and follow it:

```
read_page slug: "curata-scout-repos"
```

If the workflow page is missing on your instance, follow this file. It is complete on its own.

## Before you start, ask

- **Which repos?** Name them, or confirm "everything this agent has access to."
- **Which folder** should proposed pages land in, if the team wants a default rather than picking one each time? Optional, skip if not given.

## Flow

1. **Read what's already written.** READMEs, docs/ directories, runbooks, CLAUDE.md and AGENTS.md files, ADRs, incident and postmortem notes, anywhere a repo already explains itself, across the repos scoped above.
2. **Classify each candidate.** Company-shareable (how the team works, architecture decisions, on-call lore, FAQ-shaped answers anyone in the org would ask) versus team-local (build quirks that only make sense inside one repo). Only shareable candidates move to step 3.
3. **Check content rules before the first write.** Call `list_rules` (or `get_config`) once, before drafting anything, so the content you write already fits the org's blocking rules instead of getting rejected on the first attempt.
4. **Run `capture_thread` on the next shareable candidate.** Always, every candidate, no exceptions. It returns `dedupCandidates` against the existing brain, a checklist for the declared page type, and a `captureToken`.
5. **Show the human the `dedupCandidates`.** Stop and wait. Do not call `create_page` or `write_page` until a human has looked at the candidates and told you which way to go.
6. **Write only after the human decides.** A clear match: `patch_page` the matched slug. No match: `create_page` with `capture_token` and `dedup_ack: "new"`.
7. **Re-run `capture_thread` immediately before each write, not once for the whole batch.** The `capture_token` expires. If any time passes between minting it and writing (showing the human the candidates, waiting on a decision, moving to the next file), call `capture_thread` again right before the write instead of reusing a token that may have gone stale.
8. **Tag every page** with at least one concept so it surfaces in the brain map.
9. **Everything lands untrusted.** This skill never marks a page trusted. A human reviews and trusts from `/review`.
10. **Summarize at the end.** How many candidates found, how many proposed as new pages, how many merged into existing pages, how many skipped as team-local.

## MCP setup

Requires a curata MCP server exposing `capture_thread`, `create_page` (or `write_page`), `patch_page`, and `list_rules`, plus read access to the org's repos. See `/curata-setup` for connection setup.
