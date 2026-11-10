import type { ReviewQueueRowSerialized } from "@/components/review-queue-client";
import type { ArchivedRow } from "@/components/cleanup-client";

// Fixtures for the review and cleanup help videos. Pages are the kind a team
// that has had agents writing for a few weeks would see: the starter-prompt
// pages, a runbook, a pricing FAQ. Times are relative to now so the
// "3 days ago" labels stay stable.

const day = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * day - 3_600_000).toISOString();

function row(r: Partial<ReviewQueueRowSerialized> & Pick<ReviewQueueRowSerialized, "slug" | "title">): ReviewQueueRowSerialized {
  return {
    folderId: "f-eng",
    folderName: "Curata Engineering",
    latestEditedBy: "Claude Code",
    latestUpdatedAt: ago(0),
    neverTrusted: false,
    versionsBehind: 1,
    sinceUnapprovedAt: ago(1),
    concepts: ["engineering"],
    createdByMe: false,
    annotatedByMe: false,
    eligible: true,
    approversNote: null,
    ...r,
  };
}

export const reviewRows: ReviewQueueRowSerialized[] = [
  row({ slug: "eng-dev-setup", title: "Dev Setup and Daily Workflow", versionsBehind: 2, sinceUnapprovedAt: ago(3) }),
  row({ slug: "eng-help-videos", title: "In-App Help Videos", neverTrusted: true, versionsBehind: 0, sinceUnapprovedAt: ago(1) }),
  row({ slug: "eng-product-analytics", title: "Product Analytics (PostHog)", neverTrusted: true, versionsBehind: 0, sinceUnapprovedAt: ago(1), concepts: ["engineering", "analytics"] }),
  row({ slug: "pricing-faq", title: "Pricing FAQ", folderId: "f-sales", folderName: "Sales", latestEditedBy: "Cursor", versionsBehind: 1, sinceUnapprovedAt: ago(5), concepts: ["sales", "faq"] }),
  row({ slug: "prod-deploy-runbook", title: "Production Deploy Runbook", folderId: "f-ops", folderName: "Operations", versionsBehind: 3, sinceUnapprovedAt: ago(9), concepts: ["engineering", "runbook"] }),
];

const trustedYaml = `title: Dev Setup and Daily Workflow
subtitle: Get curata running locally in ten minutes.
components:
  - type: section
    heading: Prerequisites
    components:
      - type: markdown
        body: |
          - Node 22 and pnpm 10
          - Docker, for Postgres
  - type: section
    heading: First run
    components:
      - type: code
        language: bash
        code: ./dev.sh
`;

const latestYaml = `title: Dev Setup and Daily Workflow
subtitle: Get curata running locally in ten minutes.
components:
  - type: section
    heading: Prerequisites
    components:
      - type: markdown
        body: |
          - Node 22 and pnpm 10
          - Docker, for Postgres
          - Storybook for UI work: pnpm storybook
  - type: section
    heading: First run
    components:
      - type: code
        language: bash
        code: ./dev.sh
  - type: section
    heading: Before you push
    components:
      - type: code
        language: bash
        code: pnpm lint && pnpm test
`;

/** /api/versions answer for every slug: latest first, the older one trusted. */
export const versionsResponse = {
  versions: [
    { id: "v3", contentHash: "c3", createdBy: "Claude Code", createdAt: ago(0), yamlContent: latestYaml },
    { id: "v2", contentHash: "c2", createdBy: "Claude Code", createdAt: ago(2), yamlContent: latestYaml },
    { id: "v1", contentHash: "c1", createdBy: "Tyler", createdAt: ago(6), yamlContent: trustedYaml },
  ],
  trustedVersionId: "v1",
};

function flag(f: {
  id: string; slug: string; title: string; folderName: string | null; reason: string; action: string;
  evidence: string; confidence: string; flaggedBy: string; days: number; views: number; supersededBy?: string;
}) {
  return {
    id: f.id,
    slug: f.slug,
    title: f.title,
    folderName: f.folderName,
    pageStatus: "active",
    viewCount: f.views,
    contentUpdatedAt: ago(f.days + 40),
    lastViewedAt: ago(f.days + 20),
    action: f.action,
    reason: f.reason,
    evidence: f.evidence,
    supersededBy: f.supersededBy ?? null,
    confidence: f.confidence,
    flaggedBy: f.flaggedBy,
    flaggedAt: ago(f.days),
  };
}

/** /api/flags answer: what an agent's cleanup audit files. */
export const flagsResponse = {
  lastSweepAt: ago(1),
  flags: [
    flag({ id: "fl1", slug: "q3-launch-plan", title: "Q3 Launch Plan", folderName: "Product", reason: "shipped-not-closed", action: "archive", confidence: "high", flaggedBy: "Claude Code", days: 1, views: 4, evidence: "Every task in the plan shipped in the 1.27 release; the page still reads as in progress." }),
    flag({ id: "fl2", slug: "onboarding-checklist-v1", title: "Onboarding Checklist (v1)", folderName: "People", reason: "superseded", action: "supersede", confidence: "high", flaggedBy: "Claude Code", days: 1, views: 2, supersededBy: "onboarding-checklist", evidence: "Onboarding Checklist covers every step here plus the new laptop setup." }),
    flag({ id: "fl3", slug: "staging-access", title: "Staging Access", folderName: "Operations", reason: "stale", action: "archive", confidence: "medium", flaggedBy: "Claude Code", days: 2, views: 0, evidence: "Points at the old staging cluster, which was shut down in August. No views in 60 days." }),
    flag({ id: "fl4", slug: "pricing-faq-copy", title: "Pricing FAQ (copy)", folderName: "Sales", reason: "duplicate", action: "delete", confidence: "high", flaggedBy: "Cursor", days: 3, views: 1, evidence: "Same content as Pricing FAQ, saved twice from one thread." }),
  ],
};

export const archivedRows: ArchivedRow[] = [
  { slug: "offsite-2026-agenda", title: "Offsite 2026 Agenda", folderName: "People", updatedAt: ago(30) },
  { slug: "legacy-billing-notes", title: "Legacy Billing Notes", folderName: "Operations", updatedAt: ago(75) },
  { slug: "beta-feedback-log", title: "Beta Feedback Log", folderName: "Product", updatedAt: ago(110) },
];
