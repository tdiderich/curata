export interface Template {
  slug: string;
  title: string;
  description: string;
  persona: string;
  previewUrl: string;
}

export const TEMPLATES: Template[] = [
  // Sales
  {
    slug: "sales-forecast",
    title: "Sales Forecast",
    description: "Pipeline health, rep performance, and deal velocity",
    persona: "Sales",
    previewUrl: "/p/curata-internal/template-sales-forecast",
  },
  {
    slug: "competitive-intel-brief",
    title: "Competitive Intel Brief",
    description: "Competitor positioning, pricing, and talk tracks",
    persona: "Sales",
    previewUrl: "/p/curata-internal/template-competitive-intel-brief",
  },
  {
    slug: "deal-review-playbook",
    title: "Deal Review Playbook",
    description: "Qualification checklist, stakeholder map, and objection handling",
    persona: "Sales",
    previewUrl: "/p/curata-internal/template-deal-review-playbook",
  },
  // Engineering
  {
    slug: "agent-skills-workflows",
    title: "Agent Skills & Workflows",
    description: "What your agents do, how they're triggered, what they produce",
    persona: "Engineering",
    previewUrl: "/p/curata-internal/template-agent-skills-workflows",
  },
  {
    slug: "architecture-decision-record",
    title: "Architecture Decision Record",
    description: "Document key decisions, alternatives considered, and trade-offs",
    persona: "Engineering",
    previewUrl: "/p/curata-internal/template-architecture-decision-record",
  },
  {
    slug: "incident-postmortem",
    title: "Incident Postmortem",
    description: "Timeline, root cause analysis, and action items from an outage",
    persona: "Engineering",
    previewUrl: "/p/curata-internal/template-incident-postmortem",
  },
  {
    slug: "sprint-retrospective",
    title: "Sprint Retrospective",
    description: "What went well, what didn't, and what to change next sprint",
    persona: "Engineering",
    previewUrl: "/p/curata-internal/template-sprint-retrospective",
  },
  // CS & Ops
  {
    slug: "customer-deployment-tracker",
    title: "Customer Deployment Tracker",
    description: "Onboarding status and implementation health",
    persona: "CS & Ops",
    previewUrl: "/p/curata-internal/template-customer-deployment-tracker",
  },
  {
    slug: "vendor-tool-inventory",
    title: "Vendor & Tool Inventory",
    description: "Stack overview, owners, costs, and renewal dates",
    persona: "CS & Ops",
    previewUrl: "/p/curata-internal/template-vendor-tool-inventory",
  },
  {
    slug: "runbook-sop",
    title: "Runbook / SOP",
    description: "Step-by-step procedure for a repeatable operational task",
    persona: "CS & Ops",
    previewUrl: "/p/curata-internal/template-runbook-sop",
  },
  {
    slug: "weekly-standup-digest",
    title: "Weekly Standup Digest",
    description: "Team updates, blockers, and priorities in one place",
    persona: "CS & Ops",
    previewUrl: "/p/curata-internal/template-weekly-standup-digest",
  },
  // Product
  {
    slug: "product-spec-prd",
    title: "Product Spec / PRD",
    description: "Problem, goals, requirements, and success metrics",
    persona: "Product",
    previewUrl: "/p/curata-internal/template-product-spec-prd",
  },
  {
    slug: "user-research-summary",
    title: "User Research Summary",
    description: "Interview findings, themes, and recommended next steps",
    persona: "Product",
    previewUrl: "/p/curata-internal/template-user-research-summary",
  },
  {
    slug: "feature-launch-checklist",
    title: "Feature Launch Checklist",
    description: "Pre-launch tasks, comms plan, and rollout steps",
    persona: "Product",
    previewUrl: "/p/curata-internal/template-feature-launch-checklist",
  },
  {
    slug: "roadmap-overview",
    title: "Roadmap Overview",
    description: "Themes, priorities, and upcoming milestones by quarter",
    persona: "Product",
    previewUrl: "/p/curata-internal/template-roadmap-overview",
  },
  // Founder / CEO
  {
    slug: "investor-update",
    title: "Investor Update",
    description: "Progress, metrics, asks, and what's next",
    persona: "Founder / CEO",
    previewUrl: "/p/curata-internal/template-investor-update",
  },
  {
    slug: "org-chart-team-directory",
    title: "Org Chart & Team Directory",
    description: "Who owns what, how teams are structured, and key contacts",
    persona: "Founder / CEO",
    previewUrl: "/p/curata-internal/template-org-chart-team-directory",
  },
  {
    slug: "board-meeting-prep",
    title: "Board Meeting Prep",
    description: "Agenda, metrics, key decisions, and materials for the board",
    persona: "Founder / CEO",
    previewUrl: "/p/curata-internal/template-board-meeting-prep",
  },
  {
    slug: "company-okrs",
    title: "Company OKRs",
    description: "Objectives, key results, owners, and current progress",
    persona: "Founder / CEO",
    previewUrl: "/p/curata-internal/template-company-okrs",
  },
  {
    slug: "hiring-plan",
    title: "Hiring Plan",
    description: "Open roles, priorities, timelines, and headcount targets",
    persona: "Founder / CEO",
    previewUrl: "/p/curata-internal/template-hiring-plan",
  },
];

export const PERSONAS: string[] = [
  "Sales",
  "Engineering",
  "CS & Ops",
  "Product",
  "Founder / CEO",
];

