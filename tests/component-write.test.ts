import { describe, it, expect, vi, beforeEach } from "vitest";
import { testDb } from "./setup";
import { createTestOrg } from "./helpers";
import yaml from "js-yaml";

vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});

import { dispatch } from "@/lib/mcp-dispatch";
import { applyPatchOperations, buildOutline, ensureComponentIds, locateComponent } from "@/lib/component-ids";

const PAGE = `title: Analysis
shell: standard
components:
  - type: section
    id: intro
    heading: Intro
    components:
      - type: markdown
        id: intro-text
        body: Hello.
  - type: grid
    id: flow
    columns: 2
    children:
      - col: 1
        component:
          type: box
          id: scan
          title: Scanner
          body: Rules over source.
      - col: 2
        component:
          type: box
          id: agent
          title: Agent
          body: Reads the code.
  - type: section
    heading: Results and next steps
    components:
      - type: markdown
        body: Later.
`;

describe("component-ids deep walker", () => {
  it("outline lists nested ids with paths and depth", () => {
    const comps = ensureComponentIds((yaml.load(PAGE) as { components: Record<string, unknown>[] }).components);
    const outline = buildOutline(comps);
    const byId = Object.fromEntries(outline.map((e) => [e.id, e]));
    expect(byId["intro-text"].path).toBe("components[0].components[0]");
    expect(byId["intro-text"].depth).toBe(1);
    expect(byId["intro-text"].parentId).toBe("intro");
    expect(byId["agent"].path).toBe("components[1].children[1].component");
    expect(byId["agent"].parentId).toBe("flow");
    expect(byId["results-and-next-steps"]).toBeDefined();
    const deep = ensureComponentIds([
      { type: "grid", id: "g", columns: 1, children: [{ component: { type: "box", id: "band", title: "Band", components: [{ type: "markdown", id: "inner", body: "x" }] } }] },
    ]);
    const deepById = Object.fromEntries(buildOutline(deep).map((e) => [e.id, e]));
    expect(deepById["inner"].path).toBe("components[0].children[0].component.components[0]");
    expect(deepById["inner"].parentId).toBe("band");
    expect(locateComponent(deep, "inner")?.path).toBe("components[0].children[0].component.components[0]");
    expect(byId["results-and-next-steps"].label).toBe("Results and next steps");
  });

  it("locateComponent resolves nested ids, heading slugs, and c-<n>", () => {
    const comps = ensureComponentIds((yaml.load(PAGE) as { components: Record<string, unknown>[] }).components);
    expect(locateComponent(comps, "agent")?.path).toBe("components[1].children[1].component");
    expect(locateComponent(comps, "Results and next steps")?.path).toBe("components[2]");
    expect(locateComponent(comps, "c-0")?.path).toBe("components[0]");
    expect(locateComponent(comps, "nope")).toBeNull();
  });

  it("patch ops reach nested ids and grid children replace in place", () => {
    const page = yaml.load(PAGE) as { components: Record<string, unknown>[] };
    page.components = ensureComponentIds(page.components);
    const patched = applyPatchOperations(page, [
      { op: "replace", id: "agent", components: [{ type: "box", title: "Reviewer", body: "New body." }] },
      { op: "insert_after", id: "intro-text", components: [{ type: "callout", body: "Note" }] },
    ]);
    const grid = patched.components[1] as { children: Array<{ component: Record<string, unknown> }> };
    expect(grid.children[1].component.title).toBe("Reviewer");
    const intro = patched.components[0] as { components: Record<string, unknown>[] };
    expect(intro.components[1].type).toBe("callout");
    expect(() => applyPatchOperations(page, [{ op: "insert_after", id: "agent", components: [{ type: "markdown", body: "x" }] }])).toThrow(/grid child/);
    expect(() => applyPatchOperations(page, [{ op: "replace", id: "missing", components: [{ type: "markdown", body: "x" }] }])).toThrow(/outline/i);
  });
});

describe("read_component / write_component over MCP", () => {
  let orgId: string;
  let orgSlug: string;

  beforeEach(async () => {
    const org = await createTestOrg({ name: "Comp Org", slug: "comp-org" });
    orgId = org.id;
    orgSlug = org.slug;
    await dispatch("write_page", { slug: "analysis", content: PAGE }, orgId, orgSlug, "apikey-1", "user-1");
  });

  it("read_page carries an outline with nested ids", async () => {
    const r = (await dispatch("read_page", { slug: "analysis" }, orgId, orgSlug, "apikey-1", "user-1")) as { outline: Array<{ id: string; path: string }>; outlineText: string };
    expect(r.outline.some((e) => e.id === "agent" && e.path === "components[1].children[1].component")).toBe(true);
    expect(r.outlineText).toContain("  agent  box");
  });

  it("read_component returns one nested component with hashes", async () => {
    const r = (await dispatch("read_component", { slug: "analysis", id: "agent" }, orgId, orgSlug, "apikey-1", "user-1")) as Record<string, unknown>;
    expect(r.type).toBe("box");
    expect(r.path).toBe("components[1].children[1].component");
    expect(r.parentId).toBe("flow");
    expect(r.yaml).toContain("title: Agent");
    expect(typeof r.componentHash).toBe("string");
  });

  it("write_component replaces only the target and keeps the id", async () => {
    const before = (await dispatch("read_component", { slug: "analysis", id: "agent" }, orgId, orgSlug, "apikey-1", "user-1")) as { componentHash: string };
    const w = (await dispatch(
      "write_component",
      { slug: "analysis", id: "agent", yaml: "type: box\ntitle: Reviewer\nbody: Reads the code and rules.\n", component_hash: before.componentHash },
      orgId,
      orgSlug,
      "apikey-1",
      "user-1"
    )) as Record<string, unknown>;
    expect(w.ok).toBe(true);
    expect(w.id).toBe("agent");
    expect(w.path).toBe("components[1].children[1].component");
    const page = (await dispatch("read_page", { slug: "analysis" }, orgId, orgSlug, "apikey-1", "user-1")) as { yaml: string };
    const parsed = yaml.load(page.yaml) as { components: Array<Record<string, unknown>> };
    const grid = parsed.components[1] as { children: Array<{ component: Record<string, unknown> }> };
    expect(grid.children[1].component.title).toBe("Reviewer");
    expect(grid.children[1].component.id).toBe("agent");
    expect(grid.children[0].component.title).toBe("Scanner");
    expect((parsed.components[0] as { heading: string }).heading).toBe("Intro");
  });

  it("write_component refuses a stale component_hash and shows current YAML", async () => {
    await expect(
      dispatch("write_component", { slug: "analysis", id: "scan", yaml: "type: box\ntitle: X\nbody: y\n", component_hash: "deadbeef" }, orgId, orgSlug, "apikey-1", "user-1")
    ).rejects.toThrow(/changed since you read it[\s\S]*title: Scanner/);
  });

  it("write_component surfaces shape warnings for the new component", async () => {
    const nodes = Array.from({ length: 8 }, (_, i) => `  - { id: n${i}, label: N${i} }`).join("\n");
    const w = (await dispatch(
      "write_component",
      { slug: "analysis", id: "intro-text", yaml: `type: graph\nnodes:\n${nodes}\nedges:\n  - { from: n0, to: n1 }\n` },
      orgId,
      orgSlug,
      "apikey-1",
      "user-1"
    )) as { status?: string; shapeWarnings?: Array<{ path: string; message: string }> };
    expect(w.status).toBe("written_with_warnings");
    expect(w.shapeWarnings?.some((s) => s.path === "components[0].components[0]" && s.message.includes("set row"))).toBe(true);
  });

  it("write_component with an unknown id lists the outline", async () => {
    await expect(
      dispatch("write_component", { slug: "analysis", id: "ghost", yaml: "type: markdown\nbody: x\n" }, orgId, orgSlug, "apikey-1", "user-1")
    ).rejects.toThrow(/Outline[\s\S]*agent  box/);
  });
});
