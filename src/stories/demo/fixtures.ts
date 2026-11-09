import type { ActionBarFolder, ActionBarPage } from "@/components/action-bar-types";

// Fixture data for help-video demo screens. Mirrors what a brand-new org gets
// from the seed (two locked folders, a subset of the managed pages), so the videos show the
// real first-run state.

export const MANAGED = "f-managed";
export const QUICK = "f-quick";

export const freshFolders: ActionBarFolder[] = [
  { id: MANAGED, name: "Curata Managed Pages", parentId: null, visibility: "org", locked: true },
  { id: QUICK, name: "Quick Actions", parentId: null, visibility: "org", locked: true },
];

const managed: Array<[string, string]> = [
  ["getting-started", "Getting Started with Curata"],
  ["connecting-your-agent", "Connecting Your Agent"],
  ["mcp-tools-reference", "MCP Tools Reference"],
  ["page-structure", "Page Structure"],
  ["architecture", "Architecture"],
  ["curata-account-health-review", "Skill - Account Health Review"],
  ["curata-brain-health", "Skill - Brain Health"],
  ["curata-call-debrief", "Skill - Call Debrief"],
  ["curata-call-prep", "Skill - Call Prep"],
  ["curata-deal-review", "Skill - Deal Review"],
  ["curata-faq-capture", "Skill - FAQ Capture"],
  ["curata-import-wiki", "Skill - Import Wiki"],
  ["curata-make-connector", "Skill - Make Connector"],
  ["curata-map-org", "Skill - Map Org"],
  ["curata-planning", "Skill - Plan"],
  ["curata-scout-repos", "Skill - Scout Repos"],
  ["columns", "Production Deploy Runbook"],
  ["event-timeline", "Incident Postmortem: API Gateway Outage"],
  ["priority-queue", "Curata Rollout Plan"],
  ["org-chart", "Customer Org Chart"],
];

const SEED_TIME = "2026-11-09T09:00:00.000Z";

export const freshPages: ActionBarPage[] = managed.map(([slug, title]) => ({
  slug,
  title,
  folderId: MANAGED,
  pinned: false,
  visibility: "org",
  updatedAt: SEED_TIME,
}));

/** The page the agent saves in the welcome video's capture beat. */
export const capturedPage: ActionBarPage = {
  slug: "staging-deploy-freeze",
  title: "Staging Deploy Freeze",
  folderId: null,
  pinned: false,
  visibility: "org",
  updatedAt: "2026-11-09T09:05:00.000Z",
};

/** What the starter prompt really produced (Claude Code against a fresh
 * instance, 2026-11-09): one folder, two rules, three pages. */
export const ENG = "f-eng";
export const agentFolder: ActionBarFolder = { id: ENG, name: "Curata Engineering", parentId: null, visibility: "org" };
export const agentPages: ActionBarPage[] = [
  ["eng-dev-setup", "Dev Setup and Daily Workflow"],
  ["eng-help-videos", "In-App Help Videos"],
  ["eng-analytics", "Product Analytics (PostHog)"],
].map(([slug, title]) => ({ slug, title, folderId: ENG, pinned: false, visibility: "org", updatedAt: "2026-11-09T09:05:00.000Z" }));

export const vocabulary = {
  concepts: [
    { term: "skill", kind: "topic", usageCount: 11 },
    { term: "how-it-works", kind: "topic", usageCount: 5 },
    { term: "engineering", kind: "topic", usageCount: 4 },
  ],
  kinds: ["topic"],
};
