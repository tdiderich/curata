# Curata at a Glance — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/dashboard` renders an agent-written `home` page (read-only narrative with staleness indicator) above the existing folder/page table, falling back to exactly the current view when no `home` page exists.

**Architecture:** The home narrative is an ordinary curata page at reserved slug `home`, written by agents via the existing `write_page` MCP tool. The dashboard server component fetches it with the existing `readPage()` and renders it through the existing generated `PageRenderer` — no new renderer, no client-side changes to `DashboardClient` (that file is actively being modified in another session; do not touch it). Staleness logic is a pure function in its own lib file so it's unit-testable. Spec: `~/.gstack/projects/tdiderich-curata/tyler-main-design-20260610-101707.md` (APPROVED) — see "Phase 1 Home Page Contract."

**Tech Stack:** Next.js App Router (server components), Prisma, generated kazam `PageRenderer`, vitest.

**Working-tree caution:** Another session has uncommitted changes in `src/components/dashboard-client.tsx`, `src/app/globals.css`, and others. This plan only appends to `globals.css` (end of file) and does not modify `dashboard-client.tsx` at all. Commit only the files each task names — never `git add -A`.

---

### Task 1: Staleness lib (pure function, TDD)

**Files:**
- Create: `src/lib/home-glance.ts`
- Test: `tests/home-glance.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/home-glance.test.ts
import { describe, it, expect } from "vitest";
import { formatRefreshAge, STALE_AFTER_HOURS } from "@/lib/home-glance";

describe("formatRefreshAge", () => {
  const now = new Date("2026-06-10T12:00:00Z");

  it("reports 'just now' under an hour and is not stale", () => {
    const r = formatRefreshAge(new Date("2026-06-10T11:30:00Z"), now);
    expect(r).toEqual({ label: "just now", stale: false });
  });

  it("reports hours under a day", () => {
    const r = formatRefreshAge(new Date("2026-06-10T05:00:00Z"), now);
    expect(r).toEqual({ label: "7h ago", stale: false });
  });

  it("reports days at and beyond 24h", () => {
    const r = formatRefreshAge(new Date("2026-06-08T11:00:00Z"), now);
    expect(r).toEqual({ label: "2d ago", stale: false });
  });

  it("flags stale strictly past 72h", () => {
    const exactly72 = formatRefreshAge(new Date("2026-06-07T12:00:00Z"), now);
    expect(exactly72.stale).toBe(false);
    const past72 = formatRefreshAge(new Date("2026-06-07T11:59:00Z"), now);
    expect(past72).toEqual({ label: "3d ago", stale: true });
  });

  it("exports the 72h threshold", () => {
    expect(STALE_AFTER_HOURS).toBe(72);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/home-glance.test.ts`
Expected: FAIL — `Cannot find module '@/lib/home-glance'` (or equivalent resolve error)

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/home-glance.ts

// 72h matches the design doc's staleness criterion: past this, the
// narrative gets a visible "may be outdated" banner instead of silently
// presenting stale content as current.
export const STALE_AFTER_HOURS = 72;

export function formatRefreshAge(
  updatedAt: Date,
  now: Date = new Date()
): { label: string; stale: boolean } {
  const ms = now.getTime() - updatedAt.getTime();
  const hours = ms / (1000 * 60 * 60);
  const stale = hours > STALE_AFTER_HOURS;
  if (hours < 1) return { label: "just now", stale };
  if (hours < 24) return { label: `${Math.floor(hours)}h ago`, stale };
  return { label: `${Math.floor(hours / 24)}d ago`, stale };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/home-glance.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add tests/home-glance.test.ts src/lib/home-glance.ts
git commit -m "feat: staleness age formatter for at-a-glance home"
```

---

### Task 2: HomeGlance server component + styles

**Files:**
- Create: `src/components/home-glance.tsx`
- Modify: `src/app/globals.css` (append at end of file only — another session is editing this file)

- [ ] **Step 1: Create the component**

Server component (no `"use client"`). Read-only: no annotation UI, no edit affordances — just the header row, optional staleness banner, and the rendered page components. Mirrors the `page` object shape built in `src/app/(app)/pages/[slug]/page.tsx:92-110`.

```tsx
// src/components/home-glance.tsx
import Link from "next/link";
import { PageRenderer } from "@/generated/kazam-renderer";
import { formatRefreshAge } from "@/lib/home-glance";

export function HomeGlance({
  json,
  updatedAt,
}: {
  json: Record<string, unknown>;
  updatedAt: Date;
}) {
  const components = (json.components ?? []) as Array<{ type: string; [key: string]: unknown }>;
  if (components.length === 0) return null;

  const { label, stale } = formatRefreshAge(updatedAt);

  const page = {
    title: (json.title as string) || "Curata at a glance",
    subtitle: (json.subtitle as string) || undefined,
    shell: (json.shell as string) || "standard",
    components,
  };

  return (
    <section className="home-glance" aria-label="Workspace overview">
      <div className="home-glance-header">
        <span className="home-glance-title">{page.title}</span>
        <span className="home-glance-meta">
          refreshed {label}
          <Link href="/pages/home" className="home-glance-source">view page</Link>
        </span>
      </div>
      {stale && (
        <div className="home-glance-stale" role="status">
          Last refreshed {label} — sections may be outdated.
        </div>
      )}
      <PageRenderer page={page} activeHubHref="home" />
    </section>
  );
}
```

- [ ] **Step 2: Append styles to `src/app/globals.css`**

Append this block at the very end of the file (do not edit existing rules):

```css
/* --- Curata at a Glance (dashboard home narrative) --- */
.home-glance {
  margin-bottom: 32px;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--border, rgba(255, 255, 255, 0.08));
}
.home-glance-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 12px;
}
.home-glance-title {
  font-size: 15px;
  font-weight: 600;
}
.home-glance-meta {
  font-size: 12px;
  opacity: 0.6;
  display: inline-flex;
  gap: 10px;
}
.home-glance-source {
  text-decoration: underline;
}
.home-glance-stale {
  font-size: 12.5px;
  padding: 8px 12px;
  border-radius: 6px;
  margin-bottom: 12px;
  background: rgba(255, 180, 0, 0.12);
  color: rgb(255, 200, 90);
}
```

- [ ] **Step 3: Verify it compiles**

Run: `pnpm tsc --noEmit 2>&1 | grep -v "^\.next" || true`
Expected: no errors mentioning `home-glance` (pre-existing `.next` cache noise is fine; do NOT delete `.next` — dev server from another session may be using it)

- [ ] **Step 4: Commit**

```bash
git add src/components/home-glance.tsx src/app/globals.css
git commit -m "feat: HomeGlance read-only narrative component with staleness banner"
```

---

### Task 3: Dashboard integration

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Fetch the home page and exclude it from the table**

In `src/app/(app)/dashboard/page.tsx`, add imports at the top:

```typescript
import { listPages, readPage } from "@/lib/pages";
import { HomeGlance } from "@/components/home-glance";
```

(`listPages` is already imported — extend that line rather than duplicating it.)

After `const pages = await listPages(ctx.orgId, ctx.userId);` (line 35), add:

```typescript
// At-a-glance home: agent-written narrative page at reserved slug "home".
// Absent or empty page → dashboard falls back to the plain table (OSS fresh installs).
const homePage = await readPage(ctx.orgId, "home");
const homeRow = homePage
  ? await db.page.findUnique({
      where: { orgId_slug: { orgId: ctx.orgId, slug: "home" } },
      select: { updatedAt: true },
    })
  : null;
const tablePages = pages.filter((p) => p.slug !== "home");
```

Then change the `serialized` mapping source from `pages` to `tablePages`:

```typescript
const serialized: SerializedPageMeta[] = tablePages.map((p) => ({
```

And change the `pageCount` prop from `pages.length` to `tablePages.length`.

- [ ] **Step 2: Render HomeGlance above DashboardClient**

Replace the return statement (lines 93-104) with:

```tsx
return (
  <Suspense>
    {homePage && homeRow && (
      <HomeGlance json={homePage.json} updatedAt={homeRow.updatedAt} />
    )}
    <DashboardClient
      pages={serialized}
      folders={folders}
      pageCount={tablePages.length}
      orgName={orgName}
      allowPublic={AUTH_MODE === "clerk" || AUTH_MODE === "oauth"}
      cleanupCount={cleanupCount}
    />
  </Suspense>
);
```

Note: if the layout looks wrong (HomeGlance outside the dashboard content column), move the `<HomeGlance>` line to the equivalent slot inside the page chrome — but do NOT edit `dashboard-client.tsx`; adjust placement only in this server component.

- [ ] **Step 3: Run the full test suite**

Run: `pnpm test`
Expected: PASS — no regressions (existing tests in `tests/` don't touch the dashboard route, this is a sanity check)

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/dashboard/page.tsx"
git commit -m "feat: dashboard renders at-a-glance home page with table fallback"
```

---

### Task 4: Seed home page + visual verification

**Files:**
- Create: `scripts/seed-home.ts`
- Create: `scripts/run-seed-home.sh`

- [ ] **Step 1: Write the seed script**

The content follows the spec's "Phase 1 Home Page Contract" — 5 sections, every claim links to a source page, ~1 screen. Placeholder page links use real seeded slugs only if they exist; the markdown component tolerates dead relative links in dev.

```typescript
// scripts/seed-home.ts
// Seeds the reserved `home` page for local verification of the at-a-glance
// dashboard. In production this page is written by agents via MCP write_page
// as the final step of TS Hub workflows.
import { db } from "../src/lib/db";
import { writePage } from "../src/lib/pages";

const HOME_YAML = `title: Curata at a glance
shell: standard
components:
  - type: section
    title: What this workspace is
  - type: markdown
    body: |
      This workspace is the system of record for Technical Success customer work.
      Pages are written and maintained by AI agents via MCP; folders group
      customers, plans, blueprints, and pre-sales work. Humans read, annotate,
      and spot-check.
  - type: section
    title: What happened recently
  - type: markdown
    body: |
      - Seeded the at-a-glance home page ([home](home))
  - type: section
    title: Needs attention
  - type: markdown
    body: |
      - Nothing flagged yet — agents will rank items here with a one-line why.
  - type: section
    title: Plans in motion
  - type: markdown
    body: |
      - Curata at a Glance phase 1 — in progress
  - type: section
    title: Open questions
  - type: markdown
    body: |
      - None carried forward yet.
`;

async function main() {
  const org = await db.organization.findFirst({ select: { id: true, slug: true } });
  if (!org) throw new Error("No organization found — run the app once to seed an org.");
  const result = await writePage(org.id, org.slug, "home", HOME_YAML, "seed-script");
  if (!result.ok) throw new Error(`writePage failed: ${result.error}`);
  console.log(`Seeded home page for org ${org.slug} (hash ${result.contentHash})`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Write the runner script**

```bash
# scripts/run-seed-home.sh
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm tsx scripts/seed-home.ts
```

Run: `chmod +x scripts/run-seed-home.sh`

- [ ] **Step 3: Seed and verify in the browser**

Run: `bash scripts/run-seed-home.sh`
Expected: `Seeded home page for org curata (hash ...)`

Then open `http://localhost:3000/dashboard` (dev server already running in the other session; if not, `bash dev-curata.sh` from the project root). Verify:
1. Narrative renders above the table with "refreshed just now".
2. `home` does NOT appear in the recent-pages table below.
3. No staleness banner (page is fresh).

- [ ] **Step 4: Verify fallback**

Temporarily rename the page slug in dev DB or check a second org — simplest: confirm `/dashboard` rendered fine BEFORE seeding (it did — that was the pre-task state). Fallback path = `homePage` null → no `<HomeGlance>`. No further action if step 3 passed.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-home.ts scripts/run-seed-home.sh
git commit -m "chore: seed script for at-a-glance home page"
```

---

### Task 5: Workflow refresh steps (TS Hub runbooks — outside this repo)

**Files:** none in repo. MCP edits to `technical-success-hub` pages.

- [ ] **Step 1: List workflow pages to confirm slugs**

Use MCP tool `mcp__technical-success-hub__list_pages`; confirm these exist: `workflow-customer-call-prep`, `workflow-add-customer`, `workflow-weekly-highlights` (and any plan-update workflow the user names).

- [ ] **Step 2: Append the refresh step to each workflow page**

For each confirmed workflow page, use `mcp__technical-success-hub__read_page` then `mcp__technical-success-hub__patch_page` to append this final step (exact text from the design doc Appendix):

> **Refresh the at-a-glance home.** First read the current `home` page (`read_page home`) so you can preserve section 1 and carry forward open questions. Then list pages updated in the last 14 days (`list_pages` sorted by `updatedAt`, excluding `home` itself) and open annotations. Rewrite the `home` page in full, following the Phase 1 Home Page Contract: preserve the "What this workspace is" section unless structure changed; write 5–10 "What happened recently" bullets, each linking to its source page; rank "Needs attention" items with a one-line why; update "Plans in motion" from active plan pages; carry forward unresolved "Open questions," dropping resolved ones. Every claim must link to a source page. Keep total length ~1 screen. Write via `write_page` to slug `home`.

- [ ] **Step 3: Annotate each edited workflow page**

Use `mcp__technical-success-hub__annotate_page` on each edited page: "Added at-a-glance home refresh step (Curata at a Glance phase 1, 2026-06-10)."

---

### Task 6: Wrap-up

- [ ] **Step 1: Full test suite + lint**

Run: `pnpm test && pnpm lint`
Expected: PASS / no new errors

- [ ] **Step 2: Confirm working-tree hygiene**

Run: `git status --short`
Expected: only the OTHER session's files remain modified (`dashboard-client.tsx`, `kazam.css`, `docs/agents-reference.md`, etc.) — everything this plan touched is committed.

- [ ] **Step 3: Report**

Summarize: commits made, verification results, reminder that the 10-minute teammate test gates phase 2.
