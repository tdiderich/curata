import { describe, it, expect } from "vitest";
import {
  buildGlanceCard,
  extractGlanceSections,
  extractCustomPrompts,
  hasDashboardBlock,
  buildStaleCard,
  buildFlagCard,
  buildRecentlyCard,
  buildPageOptedCards,
} from "@/lib/glance-prompts";
import type { StalePageInfo, FlagInfo, RecentPageInfo, DashboardPageInfo } from "@/lib/glance-prompts";

const SECTION = {
  type: "section",
  heading: "Needs attention",
  components: [
    {
      type: "markdown",
      body: '- [Getting Started](getting-started) — open annotation: "fix this"\n- [Acme — TSP](acme-tsp) — open annotation: "stale"\n',
    },
  ],
};

describe("extractGlanceSections", () => {
  it("pulls heading + merged markdown body from section components", () => {
    const sections = extractGlanceSections([SECTION]);
    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBe("Needs attention");
    expect(sections[0].body).toContain("getting-started");
  });

  it("ignores non-section components", () => {
    expect(extractGlanceSections([{ type: "markdown", body: "x" }])).toHaveLength(0);
  });
});

describe("buildGlanceSections", () => {
  it("builds all three standard sections from fallbacks when the page has none", async () => {
    const { buildGlanceSections } = await import("@/lib/glance-prompts");
    const out = buildGlanceSections([], {
      recently: "- Updated [Real](real) — 2h ago",
      attention: '- [Page A](page-a) — open annotation: "fix"',
      plans: "- [Plan B](plan-b) — active",
    });
    expect(out.map((s) => s.heading)).toEqual([
      "What happened recently",
      "Needs attention",
      "Plans in motion",
    ]);
    expect(out[0].body).toContain("real");
    expect(out[1].body).toContain("page-a");
    expect(out[2].body).toContain("plan-b");
  });

  it("lets a non-empty page section override its live fallback; stub sections defer", async () => {
    const { buildGlanceSections } = await import("@/lib/glance-prompts");
    const out = buildGlanceSections(
      [
        { heading: "Needs attention", body: "- Nothing flagged.\n" },
        { heading: "What happened recently", body: "- Cohere slipped — blocked on [SSO](sso-config)\n" },
      ],
      { attention: '- [Page A](page-a) — open annotation: "fix"', recently: "- should not be used" }
    );
    expect(out[0].body).toContain("sso-config");
    expect(out[0].body).not.toContain("should not be used");
    expect(out[1].body).toContain("page-a");
  });

  it("leaves a standard section empty when there is no fallback and appends extra sections", async () => {
    const { buildGlanceSections } = await import("@/lib/glance-prompts");
    const out = buildGlanceSections(
      [{ heading: "Customer escalations", body: "- [Acme](acme-tsp) — angry\n" }],
      {}
    );
    expect(out).toHaveLength(4);
    expect(out[0].body).toBe("");
    expect(out[3].heading).toBe("Customer escalations");
    expect(out[3].body).toContain("acme-tsp");
  });
});

describe("extractCustomPrompts", () => {
  it("builds custom cards from the prompts block with context header", () => {
    const cards = extractCustomPrompts(
      {
        prompts: [
          { title: "Draft the chronicle", description: "Monthly newsletter.", prompt: "Do the chronicle." },
          { title: "missing prompt field" },
        ],
      },
      { origin: "https://x.dev" }
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].subtitle).toBe("custom");
    expect(cards[0].summary).toBe("Monthly newsletter.");
    expect(cards[0].prompt).toContain("https://x.dev/api/mcp/stream");
    expect(cards[0].prompt).toContain("Do the chronicle.");
  });

  it("returns empty for pages without a prompts block", () => {
    expect(extractCustomPrompts({})).toHaveLength(0);
  });
});

describe("buildGlanceCard", () => {
  it("builds an attention card with item count and action prompt", () => {
    const card = buildGlanceCard({ heading: "Needs attention", body: SECTION.components[0].body });
    expect(card.title).toBe("Needs attention");
    expect(card.subtitle).toBe("2 items");
    expect(card.summary).toBe(
      "Works through 2 open items across 2 pages — proposes a fix for each and applies it after your approval."
    );
    expect(card.prompt).toContain("getting-started");
    expect(card.prompt.toLowerCase()).toContain("review");
  });

  it("uses the plans template for plans in motion", () => {
    const card = buildGlanceCard({
      heading: "Plans in motion",
      body: "- [Plan A](plan-a) — active\n",
    });
    expect(card.prompt.toLowerCase()).toContain("remaining");
    expect(card.prompt).toContain("plan-a");
  });

  it("prefixes prompts with instance origin and tool guidance when origin given", () => {
    const card = buildGlanceCard(
      { heading: "Needs attention", body: SECTION.components[0].body },
      { origin: "https://curata.example.com" }
    );
    expect(card.prompt).toContain("https://curata.example.com/api/mcp/stream");
    expect(card.prompt).toContain("read_page");
    expect(card.prompt).toContain("patch_page");
  });

  it("honors an explicit prompt override (context header still prepended)", () => {
    const card = buildGlanceCard({
      heading: "Needs attention",
      body: "- item\n",
      prompt: "custom prompt text",
    });
    expect(card.prompt).toContain("custom prompt text");
    expect(card.prompt).toContain("curata MCP");
  });

  it("returns no prompt for empty-state sections", () => {
    const card = buildGlanceCard({
      heading: "Needs attention",
      body: "- Nothing flagged — no pending annotations across the workspace.\n",
    });
    expect(card.prompt).toBe("");
    expect(card.subtitle).toBe("all clear");
  });
});

describe("hasDashboardBlock", () => {
  it("returns true when dashboard has a prompt string", () => {
    expect(hasDashboardBlock({ dashboard: { prompt: "Run this workflow." } })).toBe(true);
  });

  it("returns false when dashboard has no prompt", () => {
    expect(hasDashboardBlock({ dashboard: { title: "No prompt" } })).toBe(false);
  });

  it("returns false when dashboard is not an object", () => {
    expect(hasDashboardBlock({ dashboard: true })).toBe(false);
    expect(hasDashboardBlock({})).toBe(false);
  });
});

describe("buildStaleCard", () => {
  it("builds a card with overdue pages and slugs in prompt", () => {
    const pages: StalePageInfo[] = [
      { slug: "halcyon-deploy", title: "Halcyon Deployment", staleness: "overdue", reason: "last updated 45d ago, review_every: monthly" },
      { slug: "forge-priorities", title: "Forge Priorities", staleness: "due", reason: "last updated 28d ago" },
    ];
    const card = buildStaleCard(pages, { origin: "https://x.dev" });
    expect(card.title).toBe("Stale page audit");
    expect(card.subtitle).toBe("2 overdue");
    expect(card.prompt).toContain("halcyon-deploy");
    expect(card.prompt).toContain("forge-priorities");
    expect(card.prompt).toContain("https://x.dev/api/mcp/stream");
  });

  it("returns empty prompt when no stale pages", () => {
    const card = buildStaleCard([], {});
    expect(card.subtitle).toBe("all clear");
    expect(card.prompt).toBe("");
    expect(card.summary).toBe("No stale pages to review.");
  });
});

describe("buildFlagCard", () => {
  it("builds a card with flagged pages and details in prompt", () => {
    const flags: FlagInfo[] = [
      { slug: "sunbit-tsp", title: "Sunbit TSP", action: "superseded", confidence: "high", reason: "New TSP written but old page not archived" },
    ];
    const card = buildFlagCard(flags, { origin: "https://x.dev" });
    expect(card.title).toBe("Open flags");
    expect(card.subtitle).toBe("1 flag");
    expect(card.prompt).toContain("sunbit-tsp");
    expect(card.prompt).toContain("superseded");
  });

  it("returns empty prompt when no flags", () => {
    const card = buildFlagCard([], {});
    expect(card.subtitle).toBe("all clear");
    expect(card.prompt).toBe("");
    expect(card.summary).toBe("No open flags.");
  });
});

describe("buildRecentlyCard", () => {
  it("shows normal list for 3-10 pages", () => {
    const pages: RecentPageInfo[] = [
      { slug: "page-a", title: "Page A", folderName: "Reports", updatedAt: new Date("2026-06-16T10:00:00Z") },
      { slug: "page-b", title: "Page B", folderName: "Workflows", updatedAt: new Date("2026-06-16T08:00:00Z") },
      { slug: "page-c", title: "Page C", folderName: "Reports", updatedAt: new Date("2026-06-16T06:00:00Z") },
    ];
    const card = buildRecentlyCard(pages, "today", { origin: "https://x.dev" });
    expect(card.subtitle).toBe("3 pages today");
    expect(card.prompt).toContain("page-a");
    expect(card.prompt).toContain("page-b");
    expect(card.prompt).toContain("page-c");
    expect(card.prompt).toContain("read_page");
  });

  it("groups by folder for >10 pages", () => {
    const pages: RecentPageInfo[] = Array.from({ length: 12 }, (_, i) => ({
      slug: `page-${i}`,
      title: `Page ${i}`,
      folderName: i < 8 ? "Workflows" : "Reports",
      updatedAt: new Date("2026-06-16T10:00:00Z"),
    }));
    const card = buildRecentlyCard(pages, "today", {});
    expect(card.subtitle).toBe("12 pages · 2 folders");
    expect(card.prompt).toContain("Workflows (8)");
    expect(card.prompt).toContain("Reports (4)");
  });

  it("returns empty prompt when no recent pages", () => {
    const card = buildRecentlyCard([], "30 days", {});
    expect(card.subtitle).toBe("all clear");
    expect(card.prompt).toBe("");
    expect(card.summary).toBe("No recent changes.");
  });

  it("uses window label in subtitle", () => {
    const pages: RecentPageInfo[] = [
      { slug: "p", title: "P", folderName: null, updatedAt: new Date("2026-06-10T10:00:00Z") },
      { slug: "q", title: "Q", folderName: null, updatedAt: new Date("2026-06-09T10:00:00Z") },
      { slug: "r", title: "R", folderName: null, updatedAt: new Date("2026-06-08T10:00:00Z") },
    ];
    const card = buildRecentlyCard(pages, "this week", {});
    expect(card.subtitle).toBe("3 pages this week");
  });
});

describe("buildPageOptedCards", () => {
  it("builds cards from pages with dashboard blocks, sorted by folder then title", () => {
    const pages: DashboardPageInfo[] = [
      {
        slug: "curata-call-prep-debrief",
        title: "Call Prep",
        subtitle: "Pre-call research",
        folderName: "Workflows",
        dashboard: { prompt: "Run the call prep workflow.", title: "Call prep", description: "Research + agenda" },
      },
      {
        slug: "curata-weekly-highlights",
        title: "Weekly Highlights",
        subtitle: "Cross-account digest",
        folderName: "Workflows",
        dashboard: { prompt: "Run the weekly highlights workflow." },
      },
      {
        slug: "custom-action",
        title: "Custom Action",
        subtitle: null,
        folderName: null,
        dashboard: { prompt: "Do something custom." },
      },
    ];
    const cards = buildPageOptedCards(pages, { origin: "https://x.dev" });
    expect(cards).toHaveLength(3);
    expect(cards[0].title).toBe("Custom Action");
    expect(cards[0].subtitle).toBe("custom");
    expect(cards[0].prompt).toContain('read_page("custom-action")');
    expect(cards[1].title).toBe("Call prep");
    expect(cards[1].subtitle).toBe("Workflows");
    expect(cards[1].summary).toBe("Research + agenda");
    expect(cards[2].title).toBe("Weekly Highlights");
    expect(cards[2].subtitle).toBe("Workflows");
    expect(cards[2].prompt).toContain("https://x.dev/api/mcp/stream");
    expect(cards[2].prompt).toContain("Run the weekly highlights workflow.");
    expect(cards[2].prompt).toContain('read_page("curata-weekly-highlights")');
  });

  it("returns empty for no pages", () => {
    expect(buildPageOptedCards([], {})).toHaveLength(0);
  });
});
