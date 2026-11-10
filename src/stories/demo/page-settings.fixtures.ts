import type { ChartChild, ChartNode, PageMapView } from "@/lib/chart";
import type { PageTag } from "@/components/page-settings-tags";

// Fixture data for the page-settings help video. The page is the one the
// starter prompt really wrote (agent-page.json, slug eng-dev-setup), filed in
// the folder it made. Map and rule data are illustrative but use the real
// shapes the settings page passes in.

export const SLUG = "eng-dev-setup";
export const TITLE = "Dev Setup and Daily Workflow";

export const folders = [
  { id: "f-eng", name: "Curata Engineering" },
  { id: "f-managed", name: "Curata Managed Pages" },
  { id: "f-quick", name: "Quick Actions" },
];

export const pageTags: PageTag[] = [
  { term: "engineering", kind: "topic", rel: "references" },
  { term: "dev-setup", kind: "topic", rel: "asserts" },
  { term: "prisma", kind: "vendor", rel: "depends" },
];

export const tagOptions: PageTag[] = [
  ...["skill", "faq", "how-it-works", "customers", "sales", "go-to-market", "engineering", "hr"].map((term) => ({ term, kind: "" })),
  { term: "dev-setup", kind: "topic" },
  { term: "prisma", kind: "vendor" },
  { term: "posthog", kind: "vendor" },
];

const node = (term: string, title: string, sourceSlug: string, sourceTitle: string, color: ChartNode["color"]): ChartNode => ({
  term,
  kind: "topic",
  title,
  source: { slug: sourceSlug, title: sourceTitle, updatedAt: "2026-11-07T15:20:00.000Z", updatedBy: "Claude Code", status: null },
  fanOut: 4,
  color,
  counts: { red: color === "red" ? 1 : 0, yellow: color === "yellow" ? 1 : 0, green: 3 },
  hidden: false,
  promoted: true,
  instructions: null,
  group: "watching",
});

const me = (edgeId: string, color: ChartChild["color"], reason: string | null, lastCheckedAt: string | null): ChartChild => ({
  kind: "page",
  edgeId,
  label: TITLE,
  slug: SLUG,
  url: null,
  host: null,
  rel: "depends",
  color,
  reason,
  lastCheckedAt,
  note: null,
  owner: null,
  dueAt: null,
  alsoUnder: [],
  check: null,
});

export const mapView: PageMapView = {
  under: [
    { node: node("Architecture", "Architecture", "architecture", "Architecture", "yellow"), me: me("e-arch", "yellow", "source changed since last check", "2026-11-02T10:00:00.000Z") },
    { node: node("Connecting Your Agent", "Connecting Your Agent", "connecting-your-agent", "Connecting Your Agent", "green"), me: me("e-connect", "green", null, "2026-11-08T10:00:00.000Z") },
  ],
  asNode: null,
};

export const mapNodes = [
  { term: "Architecture", title: "Architecture" },
  { term: "Connecting Your Agent", title: "Connecting Your Agent" },
  { term: "Page Structure", title: "Page Structure" },
];

export const inheritedRules = [
  { id: "r-secrets", text: "Never include API keys, tokens, or passwords", mode: "block", scope: "folder", patterns: ["sk-[A-Za-z0-9]{20,}"] },
  { id: "r-cite", text: "Cite the source files a claim comes from", mode: "warn", scope: "folder" },
];

export const pageRules = [
  { id: "r-commands", text: "Commands must match package.json scripts", mode: "warn" as const, patterns: ["pnpm (start|serve)\\b"] },
];
