import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parse as parseYaml } from "yaml";
import { PageRenderer, ComponentView, type ComponentData, type PageData } from "@/generated/kazam-renderer";
import mcpBundle from "@/generated/kazam-mcp.json";

/**
 * Doc/renderer drift guard. `kazam validate` checks a page against the
 * component schema, but the React renderer is emitted separately and can
 * disagree with the schema about a field's shape. When it does, a page passes
 * validate_page and write_page and then throws at render (React #419, blank
 * page). These tests push every documented component example and every seed
 * template through the real renderer so that class of bug fails CI instead of
 * a customer page.
 */

function renderComponent(comp: ComponentData): string {
  return renderToStaticMarkup(React.createElement(ComponentView, { comp, index: 0 }));
}

function renderPage(page: PageData): string {
  return renderToStaticMarkup(React.createElement(PageRenderer, { page }));
}

describe("documented component examples render", () => {
  const components = (mcpBundle as { components: Record<string, { example_yaml?: string | null }> }).components;
  const examples = Object.entries(components).filter(([, c]) => typeof c.example_yaml === "string" && c.example_yaml.length > 0);

  it("bundle carries at least one example", () => {
    expect(examples.length).toBeGreaterThan(0);
  });

  for (const [name, c] of examples) {
    it(`${name} example renders through the React renderer`, () => {
      const parsed = parseYaml(c.example_yaml as string) as ComponentData[] | ComponentData;
      const comps = Array.isArray(parsed) ? parsed : [parsed];
      for (const comp of comps) {
        const html = renderComponent(comp);
        expect(html.length).toBeGreaterThan(0);
      }
    });
  }
});

describe("seed pages render", () => {
  const seedRoot = path.resolve(__dirname, "../seed");
  const files: string[] = [];
  for (const dir of ["templates", "getting-started"]) {
    const full = path.join(seedRoot, dir);
    if (!fs.existsSync(full)) continue;
    for (const f of fs.readdirSync(full)) {
      if (f.endsWith(".yaml") || f.endsWith(".yml")) files.push(path.join(full, f));
    }
  }

  it("found seed pages", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${path.relative(seedRoot, file)} renders`, () => {
      const page = parseYaml(fs.readFileSync(file, "utf8")) as PageData;
      const html = renderPage(page);
      expect(html.length).toBeGreaterThan(0);
    });
  }
});

describe("table.summary", () => {
  const base = {
    type: "table",
    columns: [
      { key: "name", label: "Name" },
      { key: "tier", label: "Tier" },
    ],
    rows: [
      { name: "a", tier: "Top" },
      { name: "b", tier: "Top" },
      { name: "c", tier: "Mid" },
    ],
  };

  it("documented { group_by, colors } shape renders grouped, colored dots", () => {
    const html = renderComponent({ ...base, summary: { group_by: "tier", colors: { Top: "teal" } } });
    expect(html).toContain("c-table-summary");
    // one dot per distinct tier value, colored from the map, default otherwise
    expect(html).toContain("c-table-summary-dot color-teal");
    expect(html).toContain("c-table-summary-dot color-default");
    expect(html).toContain("Top <strong>2</strong>");
    expect(html).toContain("Mid <strong>1</strong>");
    expect(html).toContain("c-table-summary-seg color-bg-teal");
  });

  it("group_by without colors falls back to default color", () => {
    const html = renderComponent({ ...base, summary: { group_by: "tier" } });
    expect(html).toContain("c-table-summary-dot color-default");
    expect(html).not.toContain("color-undefined");
  });

  const garbage: Array<[string, unknown]> = [
    ["legacy dots array", [{ label: "x", value: 1 }]],
    ["string", "totals"],
    ["number", 42],
    ["empty object", {}],
    ["object with non-string group_by", { group_by: ["tier"] }],
    ["colors is an array", { group_by: "tier", colors: ["teal"] }],
    ["null", null],
  ];
  for (const [label, summary] of garbage) {
    it(`garbage summary (${label}) renders a plain table instead of throwing`, () => {
      const html = renderComponent({ ...base, summary });
      expect(html).toContain("<table");
      expect(html).toContain(">a<");
      if (label !== "colors is an array") expect(html).not.toContain("c-table-summary");
    });
  }

  it("rows missing or malformed still render the header", () => {
    const html = renderComponent({ type: "table", columns: base.columns, rows: "nope", summary: { group_by: "tier" } });
    expect(html).toContain("<table");
    expect(html).toContain("Tier");
  });
});
