import { describe, it, expect } from "vitest";
import { buildGlanceCard, extractGlanceSections, extractCustomPrompts } from "@/lib/glance-prompts";

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
    expect(cards[0].prompt).toContain("https://x.dev/api/mcp");
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
    expect(card.prompt).toContain("https://curata.example.com/api/mcp");
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
