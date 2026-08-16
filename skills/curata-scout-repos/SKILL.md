---
name: curata-scout-repos
description: "Cluster related repos, find the shared context or skills that would raise work quality across them, riff with the human who has the org knowledge, then build pack pages and PR skills. Use when asked to 'scout repos', 'figure out what our repos should share', or 'set up cross-repo context'."
---

# curata-scout-repos

Read the workflow from your curata instance and follow it:

```
read_page slug: "curata-scout-repos"
```

If the workflow page is missing on your instance, follow this file. It is complete on its own.

## What this skill is not

No fact extraction. Scout v1 scraped facts out of READMEs and produced page-shaped scraps nobody trusted; that flow is dead. Do not lift content out of repos into knowledge pages, and never synthesize FAQ pages from repo scans - the FAQ shape belongs to `curata-import-wiki` (digesting a targeted legacy wiki) and live captured Q&A only.

The unit of value here is a relationship between repos, not a fact inside one.

## Before you start, ask

- **Which repos?** Name them, or confirm "everything this agent has access to."

## Flow

### 1. Cluster

Light scan for relationship signals only - do not read content for its own sake:

- shared or mirrored dependencies and lockfile overlap
- CI workflows that reference another repo (sync jobs, triggers, artifact pulls)
- sync scripts, submodules, vendored copies, generated-from markers
- cross-repo URLs in docs and configs
- same deploy target, same infra module, copied tool configs (eslint, tsconfig, Dockerfiles that rhyme)

Output: proposed repo SETS, each with the evidence lines that justify it. A repo can sit in more than one cluster. A cluster without evidence is a guess - drop it.

### 2. Opportunity

Per cluster, name what shared context or skill would make work in each member higher quality:

- a convention one sibling enforces that the others lack (commit style, PR shape, error taxonomy)
- drift-prone pairs: a change in repo A that should always produce an update in repo B (code plus docs, schema plus client, template plus consumer)
- repeated setup or onboarding pain the cluster shares
- an implicit contract at the seam between two repos that nothing documents

Each opportunity states: what, the evidence, and the proposed output type - pack page, PR skill, or seam page.

### 3. Riff (mandatory gate)

Present the clusters and opportunities to the human, numbered, and stop. They have the org knowledge you do not: which clusters are real, which seams are load-bearing, which conventions are deliberate versus accidental. Ask what is missing, what is wrong, and which opportunities actually matter. Do not write anything to curata before this conversation happens. Reshape the list from their answers.

### 4. Build and maintain

Only ratified opportunities get built. Outputs, in order of preference:

- **Pack pages** - rules and conventions as an AI Tool Pack page (use the `ai-tool-pack` template via `create_from_template`). Packs compile into each repo's CLAUDE.md, AGENTS.md, and .cursorrules with `kazam install`, and `kazam check` catches drift later. One pack per cluster unless the human says otherwise.
- **PR skill instances** - for drift-prone pairs, a skill page that watches the driving repo and drafts the dependent update as a PR (the curata-docs-drift skill is the archetype: atlas or deployment-guide change lands, plain-docs PR gets drafted).
- **Seam pages** - where a cluster's connective tissue deserves prose (an implicit contract, a data handoff), one page for the seam. Not a dump of either repo's docs.

Mechanics for every write: check `list_rules` first, `search_pages` for an existing page before creating (reruns UPDATE the same pages - stable slug per cluster, patch not duplicate), tag every page with concepts, and never mark anything trusted - humans do that from `/review` where an approval rule applies.

### 5. Summarize

Clusters found, opportunities proposed, what the human cut or added at the riff, pages written or updated, and the install command for each pack (`kazam install <org>/<pack-slug>`).

## MCP setup

Requires a curata MCP server exposing `search_pages`, `create_from_template`, `create_page`, `patch_page`, and `list_rules`, plus read access to the org's repos. See `/curata-setup` for connection setup.
