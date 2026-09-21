/**
 * One-screen reference for patch_page operations. Lives here so the tool
 * description, the error messages and the seed docs all quote the same
 * text; the cold agents kept reverse-engineering the shape from errors.
 */
export const PATCH_OPS = [
  { op: "replace", needs: "id, components", does: "swap the component with id for the given component(s)" },
  { op: "insert_before", needs: "id, components", does: "insert before the component with id" },
  { op: "insert_after", needs: "id, components", does: "insert after the component with id" },
  { op: "remove", needs: "id", does: "delete the component with id" },
  { op: "prepend", needs: "components", does: "insert at the top of the page" },
  { op: "append", needs: "components", does: "insert at the bottom of the page" },
  { op: "set_field", needs: "field, value", does: "set a top-level page field: title, subtitle, eyebrow, shell" },
] as const;

export const PATCH_OPS_EXAMPLE =
  '[{"op":"replace","id":"markdown-0","components":[{"type":"markdown","id":"markdown-0","body":"## New\\n- ..."}]},{"op":"append","components":[{"type":"callout","variant":"info","body":"Nested groups ship in 2.15."}]}]';

export function patchOpsText(): string {
  return [
    "patch_page operations: a JSON array. Read the page first; expected_hash is its contentHash and the outline lists component ids.",
    ...PATCH_OPS.map((o) => `  ${o.op} (${o.needs}): ${o.does}`),
    `  "components" is an array of full component objects (type, id, fields). "value" is accepted as a single component or, for set_field, the new field value.`,
    `Example: ${PATCH_OPS_EXAMPLE}`,
  ].join("\n");
}
