---
name: curata-scout-repos
description: "Scan the repos this agent can access and propose shareable knowledge as reviewable curata pages: how-we-work notes, architecture decisions, on-call lore, FAQ-shaped answers. Use when asked to 'scout repos for curata', 'pull knowledge out of our repos', or 'seed curata from what we already have written down'."
---

# curata-scout-repos

Read the workflow from your curata instance and follow it:

```
read_page slug: "curata-scout-repos"
```

The workflow page has the full choreography - what counts as shareable, the capture flow per candidate, and the end-of-run summary. Follow it step by step.

## Quick reference

- **Read what's already written.** READMEs, docs/ directories, runbooks, CLAUDE.md and AGENTS.md files, ADRs, incident and postmortem notes - anywhere a repo already explains itself.
- **Classify each candidate.** Company-shareable (how the team works, architecture decisions, on-call lore, FAQ-shaped answers anyone in the org would ask) versus team-local (build quirks that only make sense inside one repo). Only shareable candidates get captured.
- **Run the capture choreography per candidate.** `capture_thread` first, always. Show the human any `dedupCandidates` - a clear match gets `patch_page`d, anything else becomes a new page with `capture_token` and `dedup_ack: "new"`.
- **Everything lands untrusted.** This skill never marks a page trusted. A human reviews and trusts from `/review`.
- **Tag every page** with at least one concept so it surfaces in the brain map.
- **Summarize at the end.** How many candidates found, how many proposed as new pages, how many merged into existing pages, how many skipped as team-local.

## MCP setup

Requires a curata MCP server exposing `capture_thread`, `create_page` (or `write_page`), and `patch_page`, plus read access to the org's repos. See `/curata-setup` for connection setup.
