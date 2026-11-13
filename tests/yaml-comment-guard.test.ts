import { describe, it, expect } from "vitest";
import { findTruncatingComments } from "@/lib/yaml-comment-guard";
import { validateContentSplit } from "@/lib/kazam";

const page = (body: string) => `title: Guard page
shell: standard
components:
${body}`;

describe("findTruncatingComments", () => {
  it("flags an unquoted ' #' inside a plain scalar", () => {
    const w = findTruncatingComments(page(`  - type: callout
    title: Priorities
    body: Patching is our #1 priority this quarter
`));
    expect(w).toHaveLength(1);
    expect(w[0].path).toBe("line 6");
    expect(w[0].rule).toBe("yaml-unquoted-hash");
    expect(w[0].message).toContain('"Patching is our"');
  });

  it("flags a value that is only a comment, like an unquoted hex color", () => {
    const w = findTruncatingComments(page(`  - type: box
    hex: #899878
`));
    expect(w).toHaveLength(1);
    expect(w[0].message).toContain("hex:");
  });

  it("flags list items too", () => {
    const w = findTruncatingComments(page(`  - type: list
    items:
      - Ticket #42 is closed
`));
    expect(w).toHaveLength(1);
  });

  it("leaves quoted values, block scalars, # without a space and comment lines alone", () => {
    const w = findTruncatingComments(page(`  # a real comment
  - type: callout
    title: "Patching is our #1 priority"
    subtitle: 'Ticket #42'
    tag: C#
    url: https://example.com/page#anchor
    body: |
      Markdown keeps # literal here
      ## even headings
  - type: markdown
    body: >-
      folded #1 text
`));
    expect(w).toEqual([]);
  });
});

describe("write validation", () => {
  it("returns the truncation as a non-blocking warning", async () => {
    const { errors, warnings } = await validateContentSplit("guard-org", "guard", page(`  - type: callout
    title: Priorities
    body: Patching is our #1 priority
`));
    expect(errors).toEqual([]);
    expect(warnings.some((w) => w.rule === "yaml-unquoted-hash")).toBe(true);
  });
});
