import { describe, it, expect } from "vitest";
import { ensureComponentIds, applyPatchOperations } from "@/lib/component-ids";

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

  it("deduplicates three identical sections", () => {
    const components = [
      { type: "section", eyebrow: "Topic", heading: "Same Name", components: [] },
      { type: "section", eyebrow: "Topic", heading: "Same Name", components: [] },
      { type: "section", eyebrow: "Topic", heading: "Same Name", components: [] },
    ];
    const result = ensureComponentIds(components);
    expect(result[0].id).toBe("topic-same-name");
    expect(result[1].id).toBe("topic-same-name-1");
    expect(result[2].id).toBe("topic-same-name-2");
  });

  it("deduplicates when suffixed candidate also collides with existing id", () => {
    const components = [
      { type: "section", id: "topic-same-name-1", eyebrow: "X", components: [] },
      { type: "section", eyebrow: "Topic", heading: "Same Name", components: [] },
      { type: "section", eyebrow: "Topic", heading: "Same Name", components: [] },
    ];
    const result = ensureComponentIds(components);
    expect(result[0].id).toBe("topic-same-name-1");
    expect(result[1].id).toBe("topic-same-name");
    expect(result[2].id).toBe("topic-same-name-2");
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

describe("applyPatchOperations", () => {
  const basePage = {
    title: "Test Page",
    shell: "standard" as const,
    components: [
      { type: "callout", id: "callout-0", body: "hello" },
      { type: "section", id: "topic-1-stuff", eyebrow: "Topic 1", heading: "Stuff", components: [] },
      { type: "divider", id: "divider-2" },
    ],
  };

  it("replaces a component by id", () => {
    const result = applyPatchOperations(basePage, [
      { op: "replace", id: "callout-0", components: [{ type: "callout", body: "replaced" }] },
    ]);
    expect(result.components[0]).toEqual({ type: "callout", body: "replaced" });
    expect(result.components).toHaveLength(3);
  });

  it("replace with multiple components expands array", () => {
    const result = applyPatchOperations(basePage, [
      { op: "replace", id: "divider-2", components: [{ type: "divider" }, { type: "callout", body: "extra" }] },
    ]);
    expect(result.components).toHaveLength(4);
    expect(result.components[3]).toEqual({ type: "callout", body: "extra" });
  });

  it("inserts before a target id", () => {
    const result = applyPatchOperations(basePage, [
      { op: "insert_before", id: "topic-1-stuff", components: [{ type: "image", src: "/logo.png" }] },
    ]);
    expect(result.components).toHaveLength(4);
    expect(result.components[1]).toEqual({ type: "image", src: "/logo.png" });
    expect(result.components[2].id).toBe("topic-1-stuff");
  });

  it("inserts after a target id", () => {
    const result = applyPatchOperations(basePage, [
      { op: "insert_after", id: "callout-0", components: [{ type: "divider" }] },
    ]);
    expect(result.components).toHaveLength(4);
    expect(result.components[1]).toEqual({ type: "divider" });
  });

  it("removes a component by id", () => {
    const result = applyPatchOperations(basePage, [
      { op: "remove", id: "divider-2" },
    ]);
    expect(result.components).toHaveLength(2);
    expect(result.components.find((c: Record<string, unknown>) => c.id === "divider-2")).toBeUndefined();
  });

  it("prepends to component array", () => {
    const result = applyPatchOperations(basePage, [
      { op: "prepend", components: [{ type: "image", src: "/hero.png" }] },
    ]);
    expect(result.components).toHaveLength(4);
    expect(result.components[0]).toEqual({ type: "image", src: "/hero.png" });
  });

  it("appends to component array", () => {
    const result = applyPatchOperations(basePage, [
      { op: "append", components: [{ type: "callout", body: "footer" }] },
    ]);
    expect(result.components).toHaveLength(4);
    expect(result.components[3]).toEqual({ type: "callout", body: "footer" });
  });

  it("sets page-level fields", () => {
    const result = applyPatchOperations(basePage, [
      { op: "set_field", field: "title", value: "New Title" },
      { op: "set_field", field: "subtitle", value: "May 2026" },
    ]);
    expect(result.title).toBe("New Title");
    expect(result.subtitle).toBe("May 2026");
  });

  it("throws for unknown component id", () => {
    expect(() =>
      applyPatchOperations(basePage, [{ op: "replace", id: "nonexistent", components: [] }])
    ).toThrow(/not found.*available IDs/);
  });

  it("throws for unknown operation", () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      applyPatchOperations(basePage, [{ op: "yeet" as any }])
    ).toThrow(/unknown.*op/i);
  });

  it("applies multiple operations sequentially", () => {
    const result = applyPatchOperations(basePage, [
      { op: "remove", id: "divider-2" },
      { op: "set_field", field: "title", value: "Updated" },
      { op: "append", components: [{ type: "callout", body: "end" }] },
    ]);
    expect(result.components).toHaveLength(3);
    expect(result.title).toBe("Updated");
    expect(result.components[2]).toEqual({ type: "callout", body: "end" });
  });

  it("does not mutate the original page object", () => {
    const original = JSON.parse(JSON.stringify(basePage));
    applyPatchOperations(basePage, [{ op: "set_field", field: "title", value: "Changed" }]);
    expect(basePage).toEqual(original);
  });
});
