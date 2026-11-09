import type { ChartChild, ChartColor, ChartGroup, ChartNodeDetail } from "@/lib/chart";

// Fixture content map for the map help videos (map, map-node, map-new).
// One small company's brain: a pricing page and a few standing pages that
// others depend on, with children in every state so all three colors show.

const NOW = Date.now();
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

let seq = 0;
function page(label: string, slug: string, color: ChartColor, extra: Partial<ChartChild> = {}): ChartChild {
  return {
    kind: "page",
    edgeId: `e-${++seq}`,
    label,
    slug,
    url: null,
    host: null,
    rel: "depends",
    color,
    reason: color === "red" ? "source changed twice since last check" : color === "yellow" ? "source changed since last check" : null,
    lastCheckedAt: color === "green" ? ago(1) : ago(12),
    note: null,
    owner: null,
    dueAt: null,
    alsoUnder: [],
    check: null,
    ...extra,
  };
}

function external(label: string, url: string, color: ChartColor, extra: Partial<ChartChild> = {}): ChartChild {
  return { ...page(label, "", color, extra), kind: "external", slug: null, url, host: new URL(url).host.replace(/^www\./, "") };
}

function node(
  term: string,
  title: string,
  kind: string,
  source: { slug: string; title: string; days: number; by: string; status?: string } | null,
  children: ChartChild[],
  group: ChartGroup,
): ChartNodeDetail {
  const counts = { red: 0, yellow: 0, green: 0 } as Record<ChartColor, number>;
  for (const c of children) counts[c.color]++;
  const color: ChartColor = counts.red ? "red" : counts.yellow ? "yellow" : "green";
  const order: ChartColor[] = ["red", "yellow", "green"];
  return {
    term,
    kind,
    title,
    source: source ? { slug: source.slug, title: source.title, updatedAt: ago(source.days), updatedBy: source.by, status: source.status ?? null } : null,
    fanOut: children.length,
    color,
    counts,
    hidden: false,
    promoted: true,
    instructions: null,
    group,
    children: [...children].sort((a, b) => order.indexOf(a.color) - order.indexOf(b.color)),
  };
}

export const pricingNode = node(
  "pricing",
  "Pricing",
  "topic",
  { slug: "pricing", title: "Pricing and Plans", days: 2, by: "Dana Ortiz" },
  [
    page("Sales FAQ", "sales-faq", "red", { owner: "Sam Lee", dueAt: ago(-3), alsoUnder: ["sso"] }),
    page("Enterprise Proposal Template", "enterprise-proposal-template", "red", { reason: "past due: check was due 4 days ago", owner: "Priya Shah", dueAt: ago(4) }),
    external("Pricing page (website)", "https://www.example.com/pricing", "yellow", { owner: "Marketing" }),
    page("Onboarding Email Sequence", "onboarding-email-sequence", "yellow"),
    page("Partner Reseller Guide", "partner-reseller-guide", "yellow", { lastCheckedAt: null, reason: "never checked" }),
    page("Q3 Board Deck", "q3-board-deck", "green"),
    page("Support Macros: Billing", "support-macros-billing", "green", { note: "edited" }),
  ],
  "watching",
);

export const ssoNode = node(
  "sso",
  "SSO",
  "topic",
  { slug: "sso-setup", title: "SSO Setup", days: 6, by: "Alex Kim" },
  [
    page("Security Questionnaire Answers", "security-questionnaire-answers", "yellow"),
    page("Sales FAQ", "sales-faq", "yellow", { alsoUnder: ["pricing"] }),
    page("Admin Guide", "admin-guide", "green"),
    page("IT Onboarding Checklist", "it-onboarding-checklist", "green"),
  ],
  "watching",
);

export const runbookNode = node(
  "template/runbook",
  "Runbook template",
  "template",
  { slug: "runbook-template", title: "Runbook Template", days: 20, by: "Alex Kim" },
  [
    page("Production Deploy Runbook", "production-deploy-runbook", "green", { rel: "instantiates" }),
    page("Database Failover Runbook", "database-failover-runbook", "green", { rel: "instantiates" }),
    page("Incident Response Runbook", "incident-response-runbook", "green", { rel: "instantiates" }),
  ],
  "watching",
);

export const securityNode = node(
  "security-policy",
  "Security policy",
  "topic",
  { slug: "security-policy", title: "Security Policy", days: 9, by: "Jordan Ruiz" },
  [
    page("Vendor Review Process", "vendor-review-process", "yellow"),
    page("New Hire Handbook", "new-hire-handbook", "green"),
    page("Access Request Workflow", "access-request-workflow", "green"),
  ],
  "watching",
);

export const launchNode = node(
  "launch/help-videos",
  "In-app help videos",
  "project",
  { slug: "in-app-help-videos", title: "In-App Help Videos", days: 1, by: "Tyler", status: "In progress" },
  [
    page("Release Notes: November", "release-notes-november", "yellow"),
    page("Support Playbook", "support-playbook", "green"),
    page("Getting Started Guide", "getting-started-guide", "green"),
  ],
  "active",
);

export const analyticsNode = node(
  "launch/analytics",
  "Product analytics",
  "project",
  { slug: "product-analytics", title: "Product Analytics (PostHog)", days: 4, by: "Tyler", status: "Planned" },
  [
    page("Privacy Notice", "privacy-notice", "green"),
    page("Data Retention Policy", "data-retention-policy", "green"),
    page("Self-hosting Guide", "self-hosting-guide", "green"),
  ],
  "active",
);

export const doneNode = node(
  "launch/sso",
  "SSO launch",
  "project",
  { slug: "sso-launch", title: "SSO Launch", days: 40, by: "Alex Kim", status: "Shipped" },
  [
    page("Launch Blog Post", "launch-blog-post", "green"),
    page("Sales Enablement: SSO", "sales-enablement-sso", "green"),
    page("Admin Guide", "admin-guide", "green"),
  ],
  "completed",
);

export const watching = [pricingNode, ssoNode, securityNode, runbookNode];
export const allNodes = [launchNode, analyticsNode, ...watching, doneNode];
export const needsLook = allNodes.filter((n) => n.counts.red + n.counts.yellow > 0);

/** Pages the new-item form's search can find. The story's fetch mock filters by title. */
export const searchPages = [
  { slug: "data-retention-policy", title: "Data Retention Policy", type: "page" },
  { slug: "data-processing-agreement", title: "Data Processing Agreement", type: "page" },
  { slug: "privacy-notice", title: "Privacy Notice", type: "page" },
  { slug: "security-questionnaire-answers", title: "Security Questionnaire Answers", type: "page" },
  { slug: "security-policy", title: "Security Policy", type: "page" },
  { slug: "self-hosting-guide", title: "Self-hosting Guide", type: "page" },
];
