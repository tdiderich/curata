import { describe, it, expect } from "vitest";
import { ensureComponentIds } from "@/lib/component-ids";

describe("ensureComponentIds", () => {
  it("stamps id on section from eyebrow + heading", () => {
    const components = [
      { type: "section", eyebrow: "Topic 1", heading: "Maze Code Opportunities", components: [] },
    ];
    const result = ensureComponentIds(components);
    expect(result[0].id).toBe("topic-1-maze-code-opportunities");
  });

  it("stamps id on section with only eyebrow", () => {
    const components = [
      { type: "section", eyebrow: "Overview", components: [] },
    ];
    const result = ensureComponentIds(components);
    expect(result[0].id).toBe("overview");
  });

  it("stamps id on section with only heading", () => {
    const components = [
      { type: "section", heading: "Full Scale Deployment Plan", components: [] },
    ];
    const result = ensureComponentIds(components);
    expect(result[0].id).toBe("full-scale-deployment-plan");
  });

  it("stamps type-index id on non-section components", () => {
    const components = [
      { type: "callout", body: "hello" },
      { type: "divider" },
      { type: "table", columns: [], rows: [] },
    ];
    const result = ensureComponentIds(components);
    expect(result[0].id).toBe("callout-0");
    expect(result[1].id).toBe("divider-1");
    expect(result[2].id).toBe("table-2");
  });

  it("preserves existing user-authored ids", () => {
    const components = [
      { type: "section", id: "my-custom-id", eyebrow: "Test", heading: "Thing", components: [] },
      { type: "divider", id: "my-divider" },
    ];
    const result = ensureComponentIds(components);
    expect(result[0].id).toBe("my-custom-id");
    expect(result[1].id).toBe("my-divider");
  });

  it("deduplicates colliding generated ids by appending index", () => {
    const components = [
      { type: "section", eyebrow: "Topic", heading: "Same Name", components: [] },
      { type: "section", eyebrow: "Topic", heading: "Same Name", components: [] },
    ];
    const result = ensureComponentIds(components);
    expect(result[0].id).toBe("topic-same-name");
    expect(result[1].id).toBe("topic-same-name-1");
  });

  it("deduplicates when generated id collides with existing id", () => {
    const components = [
      { type: "section", id: "overview", eyebrow: "X", components: [] },
      { type: "section", eyebrow: "Overview", components: [] },
    ];
    const result = ensureComponentIds(components);
    expect(result[0].id).toBe("overview");
    expect(result[1].id).toBe("overview-1");
  });

  it("handles empty components array", () => {
    expect(ensureComponentIds([])).toEqual([]);
  });

  it("handles section with no eyebrow or heading — falls back to type-index", () => {
    const components = [
      { type: "section", components: [{ type: "markdown", body: "hi" }] },
    ];
    const result = ensureComponentIds(components);
    expect(result[0].id).toBe("section-0");
  });

  it("does not mutate the original array", () => {
    const components = [{ type: "divider" }];
    const original = JSON.parse(JSON.stringify(components));
    ensureComponentIds(components);
    expect(components).toEqual(original);
  });
});
