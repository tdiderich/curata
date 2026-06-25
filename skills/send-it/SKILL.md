---
name: send-it
description: "Push curata changes through the full release pipeline: curata OSS → curata-app → maze-apps. Use when asked to 'send it', 'push this out', 'deploy', or 'release'."
---

# send-it — Curata Release Pipeline

Push changes from curata OSS through all downstream repos.
Strictly sequential — each phase must complete before the next begins.

## Pipeline

```
curata OSS (source of truth)
  ↓  commit + push (pre-push runs: pnpm generate + next build + vitest)
curata-app (SaaS overlay)
  ↓  empty commit + push (pre-push clones OSS, overlays extensions/, builds, tests)
maze-apps (org TS Hub)
  ↓  sync workflow → PR → merge
done
```

## Phase 1 — curata OSS: commit + push

1. Check for uncommitted changes: `git status`
2. If kazam binary changed, regenerate first: `pnpm generate`
3. Commit changes (use `--no-verify` only for generated files blocked by pre-commit hook)
4. Push to main: `git push origin main`
5. **WAIT** — pre-push runs build + tests. Must pass before proceeding.

Working directory: `~/personal-repos/kazam-curata-project/curata`

## Phase 2 — curata-app: trigger rebuild

1. `cd ~/personal-repos/kazam-curata-project/curata-app`
2. `git pull origin main`
3. Push empty commit to trigger rebuild:
   ```
   git commit --allow-empty -m "chore: trigger rebuild — <describe what changed>"
   git push origin main
   ```
4. **WAIT** — pre-push clones curata OSS fresh, overlays extensions/, runs full build + tests.

## Phase 3 — maze-apps: sync + merge

1. `cd ~/maze-repos/maze-apps && git pull origin main`
2. Trigger sync: `gh workflow run "Sync Curata from OSS"`
3. **WAIT** — check workflow status: `gh run list --limit 1`
4. Once complete, find and merge PR:
   ```
   gh pr list --search "curata"
   gh pr merge <number> --squash --delete-branch
   ```

## Kazam-first variant

If kazam (Rust CLI) also changed, prepend this before Phase 1:

1. `cd ~/personal-repos/kazam-curata-project/kazam`
2. `cargo build --release`
3. `cp target/release/kazam ../curata/.bin/kazam`
4. Commit + push kazam: `git push origin main`
5. **WAIT** for Release workflow: `gh run list --limit 3`
6. Verify Release shows `completed success` before proceeding to Phase 1.

## Loop mode

User may request `/loop` to auto-check deploys. When looping:
- Check workflow status every ~90s
- Proceed to next phase immediately when current phase completes
- Report each phase transition
