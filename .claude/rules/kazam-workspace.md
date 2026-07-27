# Kazam Workspace

This project uses **kazam** for task tracking and context intelligence.
Use kazam for ALL task tracking — do NOT use the built-in TaskCreate/TaskUpdate tools.
State lives in `.kazam/` as YAML files.

## Prerequisites
- kazam must be installed: `cargo install --git https://github.com/tdiderich/kazam`
- If `kazam` is not on PATH, install it before using any workspace commands.

## Navigating the codebase — MANDATORY
**Before you `grep`, `find`, `ls`, or spawn a subagent to explore, read the
anatomy index.** This is not optional. The index exists so you don't waste
tokens scanning the filesystem.

**Step 1 — Read the summary:**
`.kazam/ctx/anatomy.tsv` — compact index with root files and directory rollups
(file count, total tokens, description). ~68 lines even for huge repos.

**Step 2 — Drill into a directory:**
`.kazam/ctx/anatomy/<dir>.tsv` — individual files in that directory.
Nested paths use `--` as separator: `frontend/src/app` → `anatomy/frontend--src--app.tsv`.

**Step 3 — Read the source file you need.**

Summary → detail → source. Three reads, zero exploration.

**For multi-file exploration** (where is X, what calls Y, bug hunts across
directories), dispatch the `kazam-scout` agent instead of exploring in your
own context. It navigates anatomy-first and returns compact `file:line`
citations, keeping file dumps out of the main conversation.

**When delegating to subagents:** subagents don't see these rules, so you
must brief them. Include in every subagent prompt:
1. **Anatomy:** "Read `.kazam/ctx/anatomy.tsv` for project layout, then
   `.kazam/ctx/anatomy/<dir>.tsv` for the directory you need — don't
   grep or find for structure."
2. **Task context:** "You are working on task `<ID>`: <title>. When done,
   run `kazam track close <ID> --reason '<what you did>'`."
3. **Enrichment:** "After reading an unfamiliar file, run
   `kazam ctx describe <path> '<description>'`."

## On session start or context recovery
The `SessionStart` hook already prints anatomy drift and ready tasks, so you
normally start oriented. Re-run `kazam track ready --json` any time you need it
again.

**After a `/compact` or auto-compaction** the same hook prints a fuller recovery
payload: claimed tasks with their notes, the activity logged during the stretch
that was summarized away, uncommitted file drift, standing corrections, and
recent learnings. Treat that payload as authoritative. The compaction summary is
lossy; `.kazam/` is not. Where they disagree, `.kazam/` wins.

This works because the `PreCompact` hook writes a `compact boundary` entry to
`track/log.yaml` on the way out, which is what lets the recovery payload replay
exactly the work belonging to the discarded transcript. Nothing is stored
outside kazam's normal stores, so there is no second source of truth to drift.

## Before starting work
- Claim a task: `kazam track claim <ID> --name <your-name>`.
- **MANDATORY: before fixing any error**, run `kazam ctx bugs --file <path>`
  to check if it was solved before. Do not skip this step.

## During work — close tasks as you go, don't batch
- **After each commit**, check if it completes an open task. If so, close it
  immediately: `kazam track close <ID> --reason "what you did"`.
- Tasks with `--owner human` are not yours to close. If one blocks your work,
  mark it blocked: `kazam track block <ID> --reason "why"`. When the user
  completes a human task, close it for them.
- After reading an unfamiliar file, enrich its description:
  `kazam ctx describe <path> "what this file actually does"`.
- Record non-obvious learnings: `kazam ctx learn "lesson" --category correction`.
- Record bugs you find: `kazam ctx bug "symptom" --file <path>`.
- When the user corrects your approach, record it immediately:
  `kazam ctx correction "what you did wrong" "what to do instead" --file <path>`.

## Quick reference
```
kazam track ready --json     # unblocked tasks by priority
kazam track close <ID> --reason "..."   # mark task done
kazam track block <ID> --reason "..."   # mark task blocked
kazam track list --json      # all tasks with status
kazam ctx describe <path> "description" # enrich file description
kazam ctx bugs --file <path> # known bugs on a file
kazam ctx learn "lesson" --category correction
kazam ctx bug "symptom" --file <path>
kazam ctx correction "mistake" "fix" --file <path>  # record a correction
kazam ctx corrections --json   # view past corrections
```

## Direct YAML editing
You may edit `.kazam/track/tasks.yaml` or `.kazam/ctx/*.yaml` directly.
The board (`kazam board`) auto-refreshes on any `.kazam/*.yaml` change.

## Team overrides

<!-- Team-specific workspace rules. Content here is appended to
     .claude/rules/kazam-workspace.md on each `kazam workspace init`.
     Add conventions, safety guards, or push policies your team needs. -->

