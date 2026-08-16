export interface Template {
  slug: string;
  title: string;
  description: string;
  group: string;
  previewUrl: string;
}

export const TEMPLATES: Template[] = [
  // Present
  {
    slug: "showcase-deck",
    title: "Deck: Slide Presentation",
    description: "A slide-by-slide narrative with a cover slide, built for a live walkthrough like a QBR.",
    group: "Present",
    previewUrl: "/p/curata-internal/template-showcase-deck",
  },
  {
    slug: "showcase-hub",
    title: "Hub: Multi-Page Collection",
    description: "Shared navigation and one status across a small set of related pages, like a launch hub.",
    group: "Present",
    previewUrl: "/p/curata-internal/template-showcase-hub",
  },
  // Reuse
  {
    slug: "showcase-shared-component",
    title: "Shared Component",
    description: "A fact written once and embedded everywhere, so one approval updates every page that references it.",
    group: "Reuse",
    previewUrl: "/p/curata-internal/template-showcase-shared-component",
  },
  {
    slug: "showcase-ref-embeds",
    title: "Page With Embedded Components",
    description: "Embeds a shared component page twice, mixed with its own content, using a ref block.",
    group: "Reuse",
    previewUrl: "/p/curata-internal/template-showcase-ref-embeds",
  },
  // Procedures
  {
    slug: "showcase-steps-checklist",
    title: "Steps and Checklists",
    description: "Numbered steps for a runbook, plus an unordered list for pre-flight items where order doesn't matter.",
    group: "Procedures",
    previewUrl: "/p/curata-internal/template-showcase-steps-checklist",
  },
  {
    slug: "skill",
    title: "Skill: Agent Procedure",
    description: "An agent procedure: trigger, steps, and an optionally AGL-validated flow",
    group: "Procedures",
    previewUrl: "/p/curata-internal/template-skill",
  },
  // Structured data
  {
    slug: "showcase-stat-timeline",
    title: "Stats and Timelines",
    description: "A stat grid for the headline numbers, and a timeline underneath for status at a glance.",
    group: "Structured data",
    previewUrl: "/p/curata-internal/template-showcase-stat-timeline",
  },
  {
    slug: "showcase-tables",
    title: "Tables and Card Grids",
    description: "A filterable table for scanning by column, and a card grid with badges for browsing visually.",
    group: "Structured data",
    previewUrl: "/p/curata-internal/template-showcase-tables",
  },
  // Emphasis and layout
  {
    slug: "showcase-tabs-accordion",
    title: "Tabs and Accordions",
    description: "Tabs for content that genuinely forks, and an accordion for optional detail someone can skip.",
    group: "Emphasis and layout",
    previewUrl: "/p/curata-internal/template-showcase-tabs-accordion",
  },
  {
    slug: "showcase-callouts",
    title: "Callouts, Badges, Dividers",
    description: "Every callout variant, every badge color, and labeled dividers, in a security-posture brief.",
    group: "Emphasis and layout",
    previewUrl: "/p/curata-internal/template-showcase-callouts",
  },
  // Documents
  {
    slug: "showcase-document",
    title: "Document: Print-Ready",
    description: "The document shell with print_flow set, built for a memo someone will export or print.",
    group: "Documents",
    previewUrl: "/p/curata-internal/template-showcase-document",
  },
  // Agents
  {
    slug: "ai-tool-pack",
    title: "AI Tool Pack",
    description: "Rules and guardrails that install into CLAUDE.md, AGENTS.md, and .cursorrules with kazam install",
    group: "Agents",
    previewUrl: "/p/curata-internal/template-ai-tool-pack",
  },
  {
    slug: "agent-skills-workflows",
    title: "Agent Skills & Workflows",
    description: "What your agents do, how they're triggered, what they produce",
    group: "Agents",
    previewUrl: "/p/curata-internal/template-agent-skills-workflows",
  },
];

export const GROUPS: string[] = [
  "Present",
  "Reuse",
  "Procedures",
  "Structured data",
  "Emphasis and layout",
  "Documents",
  "Agents",
];
