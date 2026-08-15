import { describe, it, expect, vi } from "vitest";
import { createTestOrg, createTestPage } from "./helpers";

vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});

import { findCaptureDedupCandidates } from "@/lib/capture-dedup";

// Generic sales-vocabulary body text that shows up on nearly every page of a
// sales-heavy corpus — the exact shape of noise kz-1fb3c7 reported (customer,
// instance, credential, production matched everywhere on a 238-page org).
function genericBody(i: number): string {
  return `Notes about customer account number ${i}. The production instance uses a
service credential rotated on renewal. Support reviewed the customer account
and confirmed the instance credential is current for this account.`;
}

const THREAD_GENERIC_ONLY = "Our customer asked about the production instance credential for their account renewal.";

const NIGHTINGALE_PAGE_BODY = `Project Nightingale migration plan: cutover window, rollback procedure, and
staging validation steps before the nightingale migration goes live.`;

const THREAD_NIGHTINGALE = "The nightingale migration cutover rollback plan needs updating before staging pushes it live.";

describe("findCaptureDedupCandidates at corpus scale", () => {
  it("suppresses generic-vocabulary candidates on a large synthetic corpus (no real match)", async () => {
    const org = await createTestOrg({ name: "Large Corpus Org", slug: `large-corpus-org-${Math.random().toString(36).slice(2)}` });

    for (let i = 0; i < 220; i++) {
      await createTestPage(org.id, {
        slug: `generic-page-${i}`,
        title: `Generic Notes ${i}`,
        yamlContent: `title: Generic Notes ${i}\nshell: document\ncomponents:\n  - type: markdown\n    body: "${genericBody(i)}"\n`,
      });
    }

    const candidates = await findCaptureDedupCandidates(org.id, THREAD_GENERIC_ONLY);
    expect(candidates).toEqual([]);
  }, 30000);

  it("still surfaces a genuine near-duplicate sharing rare, distinctive terms on that same large corpus", async () => {
    const org = await createTestOrg({ name: "Large Corpus Dup Org", slug: `large-corpus-dup-org-${Math.random().toString(36).slice(2)}` });

    for (let i = 0; i < 220; i++) {
      await createTestPage(org.id, {
        slug: `generic-page-${i}`,
        title: `Generic Notes ${i}`,
        yamlContent: `title: Generic Notes ${i}\nshell: document\ncomponents:\n  - type: markdown\n    body: "${genericBody(i)}"\n`,
      });
    }
    await createTestPage(org.id, {
      slug: "project-nightingale-migration-plan",
      title: "Project Nightingale Migration Plan",
      yamlContent: `title: Project Nightingale Migration Plan\nshell: document\ncomponents:\n  - type: markdown\n    body: "${NIGHTINGALE_PAGE_BODY}"\n`,
    });

    const candidates = await findCaptureDedupCandidates(org.id, THREAD_NIGHTINGALE);
    expect(candidates.some((c) => c.slug === "project-nightingale-migration-plan")).toBe(true);
  }, 30000);

  it("keeps small-corpus term-level matching working (2 shared distinctive terms is still enough below the corpus-size bar)", async () => {
    const org = await createTestOrg({ name: "Small Corpus Org", slug: `small-corpus-org-${Math.random().toString(36).slice(2)}` });

    // A handful of unrelated pages plus one page that shares two rare terms
    // with the thread — under the 80-page corpusMinTermHits step-up, the
    // original MIN_TERM_HITS=2 floor still governs.
    for (let i = 0; i < 5; i++) {
      await createTestPage(org.id, {
        slug: `small-unrelated-${i}`,
        title: `Unrelated Topic ${i}`,
        yamlContent: `title: Unrelated Topic ${i}\nshell: document\ncomponents:\n  - type: markdown\n    body: "Nothing to do with the thread at all, topic ${i}."\n`,
      });
    }
    await createTestPage(org.id, {
      slug: "small-corpus-dup",
      title: "Falcon Deployment Runbook",
      yamlContent: `title: Falcon Deployment Runbook\nshell: document\ncomponents:\n  - type: markdown\n    body: "Falcon deployment runbook covers canary rollout and blue-green rollback steps."\n`,
    });

    const thread = "The falcon deployment canary rollout and blue-green rollback need a second look.";
    const candidates = await findCaptureDedupCandidates(org.id, thread);
    expect(candidates.some((c) => c.slug === "small-corpus-dup")).toBe(true);
  });
});
