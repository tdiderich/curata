import { describe, it, expect, vi, beforeEach } from "vitest";
import { testDb } from "./setup";
import { createTestOrg } from "./helpers";

// Real kazam binary on purpose: these tests exercise the shape-rule path
// end to end (curata -> temp kazam.yaml -> kazam validate -> warnings).
vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});

import { dispatch } from "@/lib/mcp-dispatch";
import { formatWarningsBlock, validateContentSplit } from "@/lib/kazam";
import { parseShapeRules, validateShapeRule } from "@/lib/shape-rules";
import { componentSlice, toolDescription, guidedComponents } from "@/lib/mcp-guidance";

const nineNodeGraph = (withRows: boolean) => {
  const nodes = Array.from({ length: 9 }, (_, i) =>
    withRows
      ? `      - { id: n${i}, label: N${i}, row: ${Math.floor(i / 3) + 1}, column: ${(i % 3) + 1} }`
      : `      - { id: n${i}, label: N${i} }`
  ).join("\n");
  return `title: Graph page
shell: standard
components:
  - type: graph
    id: g
    nodes:
${nodes}
    edges:
      - { from: n0, to: n1 }
`;
};

describe("shape rules over MCP", () => {
  let orgId: string;
  let orgSlug: string;

  beforeEach(async () => {
    const org = await createTestOrg({ name: "Shape Org", slug: "shape-org" });
    orgId = org.id;
    orgSlug = org.slug;
  });

  it("write_page succeeds and carries shapeWarnings for a 9-node graph without rows", async () => {
    const result = (await dispatch(
      "write_page",
      { slug: "graph-warn", content: nineNodeGraph(false) },
      orgId,
      orgSlug,
      "apikey-1",
      "user-1"
    )) as Record<string, unknown>;
    expect(result.ok).toBe(true);
    expect(result.status).toBe("written_with_warnings");
    const warnings = result.shapeWarnings as Array<{ path: string; component: string; message: string; rule?: string }>;
    expect(warnings.length).toBeGreaterThan(0);
    const rowWarning = warnings.find((w) => w.path === "components[0]" && w.message.includes("set row"));
    expect(rowWarning).toBeDefined();
    expect(rowWarning?.component).toBe("graph");
    expect(rowWarning?.rule).toContain("nodes > 6");
    const page = await testDb.page.findUnique({ where: { orgId_slug: { orgId, slug: "graph-warn" } } });
    expect(page).not.toBeNull();
  });

  it("a tiered 9-node graph writes clean", async () => {
    const result = (await dispatch(
      "write_page",
      { slug: "graph-clean", content: nineNodeGraph(true) },
      orgId,
      orgSlug,
      "apikey-1",
      "user-1"
    )) as Record<string, unknown>;
    expect(result.ok).toBe(true);
    expect(result.status).toBeUndefined();
    expect(result.shapeWarnings).toBeUndefined();
  });

  it("validate_page returns warnings separately from errors", async () => {
    const result = (await dispatch(
      "validate_page",
      { slug: "whatever", content: nineNodeGraph(false) },
      orgId,
      orgSlug,
      "apikey-1",
      "user-1"
    )) as { valid: boolean; errors: string[]; warnings: Array<{ path: string }> };
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((w) => w.path === "components[0]")).toBe(true);
  });

  it("org shape rules (kind: shape) reach the kazam engine and are scoped", async () => {
    await dispatch(
      "set_rules",
      {
        scope: "global",
        rules: JSON.stringify([
          { id: "short-md", kind: "shape", component: "markdown", warn: "words(body) > 3", say: "Org says keep it short." },
        ]),
      },
      orgId,
      orgSlug,
      "apikey-1",
      "user-1"
    );
    const result = (await dispatch(
      "write_page",
      { slug: "md-page", content: "title: M\nshell: standard\ncomponents:\n  - type: markdown\n    body: one two three four five\n" },
      orgId,
      orgSlug,
      "apikey-1",
      "user-1"
    )) as Record<string, unknown>;
    const warnings = result.shapeWarnings as Array<{ message: string }>;
    expect(warnings.some((w) => w.message.includes("Org says keep it short"))).toBe(true);

    const rules = (await dispatch("list_rules", { slug: "md-page" }, orgId, orgSlug, "apikey-1", "user-1")) as { shape: Array<{ id: string; scope: string }> };
    expect(rules.shape).toEqual([expect.objectContaining({ id: "short-md", scope: "global" })]);
  });

  it("set_rules rejects a malformed shape rule", async () => {
    await expect(
      dispatch(
        "set_rules",
        { scope: "global", rules: JSON.stringify([{ kind: "shape", component: "graph", say: "no expression" }]) },
        orgId,
        orgSlug,
        "apikey-1",
        "user-1"
      )
    ).rejects.toThrow(/invalid shape rule/);
  });

  it("get_component_reference with component returns a short slice with the curated example", async () => {
    const result = (await dispatch("get_component_reference", { component: "graph" }, orgId, orgSlug, "apikey-1", "user-1")) as { component: string; content: string };
    expect(result.component).toBe("graph");
    expect(result.content).toContain("**Use when:**");
    expect(result.content).toContain("row: 1");
    expect(result.content).toContain("Shape rules");
    expect(result.content.split("\n").length).toBeLessThan(120);
  });

  it("get_component_reference with an unknown component lists the guided ones", async () => {
    await expect(
      dispatch("get_component_reference", { component: "nope" }, orgId, orgSlug, "apikey-1", "user-1")
    ).rejects.toThrow(/Guided components: .*graph/);
  });
});

describe("guidance bundle and helpers", () => {
  it("tool descriptions come from the generated bundle and mention warnings", () => {
    const d = toolDescription("write_page", "fallback");
    expect(d).not.toBe("fallback");
    expect(d).toContain("WARNINGS");
    expect(d).toContain("get_component_reference");
    expect(guidedComponents()).toContain("pipeline");
    expect(componentSlice("pipeline")?.rules.length).toBeGreaterThan(0);
  });

  it("formatWarningsBlock leads with the count and is empty with no warnings", () => {
    expect(formatWarningsBlock([])).toBe("");
    const block = formatWarningsBlock([{ path: "components[2]", component: "graph", message: "Set row on every node.", rule: "nodes > 6", scope: "schema" }]);
    expect(block.startsWith("WARNINGS (1)")).toBe(true);
    expect(block).toContain("components[2] (graph): Set row on every node. [rule: nodes > 6]");
  });

  it("parseShapeRules keeps only well-formed shape entries", () => {
    const parsed = parseShapeRules([
      { kind: "shape", component: "box", warn: "words(body) > 10", say: "Trim." },
      { kind: "shape", component: "box", warn: "words(body) > 10" },
      { kind: "approval", approvers: [] },
      { id: "x", text: "no em dash", mode: "block" },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].component).toBe("box");
    expect(validateShapeRule({ component: "box", warn: "x > 1", say: "y", severity: "loud" })).toEqual({ ok: false, error: 'severity must be "warning" or "error"' });
  });

  it("validateContentSplit separates blocking errors from shape warnings", async () => {
    const split = await validateContentSplit("shape-org", "p", "title: T\nshell: standard\ncomponents:\n  - type: card_grid\n    cards: []\n");
    expect(split.errors.length).toBeGreaterThan(0);
    expect(split.errors.every((e) => e.severity !== "warning")).toBe(true);
  });
});
