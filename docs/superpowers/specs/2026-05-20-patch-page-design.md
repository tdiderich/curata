# patch_page — Partial Page Updates via MCP

**Date:** 2026-05-20
**Status:** Design approved

## Problem

`write_page` requires the full YAML content for every update. Adding a logo to a 200-line page means re-sending all 200 lines. This wastes tokens, increases latency (full MCP round-trip for minor changes), and risks accidental content loss if the agent reconstructs YAML incorrectly.

## Solution

Two changes:

1. **Auto-generate stable IDs** on top-level components so they can be targeted by a patch operation.
2. **New `patch_page` MCP tool** that applies targeted operations (replace, insert, remove, set field) without requiring a full YAML rewrite.

## Design

### Auto-generated Component IDs

A shared `ensureComponentIds(components)` function walks the top-level `components` array and stamps an `id` on any component that lacks one.

**ID generation rules:**
- If the component already has an `id`, keep it (user-authored IDs take precedence).
- For `section` type: derive from `{eyebrow}-{heading}` → kebab-case. Example: `eyebrow: "Topic 1"`, `heading: "Maze Code Opportunities"` → `id: "topic-1-maze-code-opportunities"`.
- For `section` with only eyebrow or only heading: use whichever is present.
- For all other types: `{type}-{index}` where index is the component's position in the top-level array. Example: `divider` at index 3 → `id: "divider-3"`.
- Dedup: if a generated ID collides with an existing ID in the array, append `-{index}`.

**Where it runs (approach C — generate on both):**
- **On save:** `writePage` runs `ensureComponentIds` on the parsed components before storing. Pages saved going forward always have IDs in the database.
- **On read:** `read_page` dispatch runs `ensureComponentIds` on the parsed YAML before returning. Pages that haven't been re-saved yet still get IDs in the MCP response.

This means: every `read_page` response includes IDs on all top-level components, regardless of whether the page was originally authored with them. Over time, as pages are edited, IDs converge to being persisted in the database.

**ID stability:** IDs derived from eyebrow/heading are content-stable (same content = same ID across reads). Index-based IDs (for non-section components) are position-stable — they change if components are reordered, but `expected_hash` gating on `patch_page` catches this.

### `patch_page` MCP Tool

**Tool name:** `patch_page`
**Type:** write
**Args:**

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `slug` | string | yes | Page slug |
| `expected_hash` | string | yes | Content hash from last `read_page` — rejects if stale |
| `operations` | string (JSON array) | yes | Array of patch operations |

**Operations:**

```jsonc
[
  // Replace a component by ID with one or more new components
  { "op": "replace", "id": "topic-1-maze-code-opps", "components": [{ "type": "section", ... }] },

  // Insert component(s) before or after a target ID
  { "op": "insert_before", "id": "divider-3", "components": [{ "type": "image", "src": "/assets/logo.png" }] },
  { "op": "insert_after", "id": "topic-1-maze-code-opps", "components": [{ "type": "divider" }] },

  // Remove a component by ID
  { "op": "remove", "id": "divider-3" },

  // Prepend/append to root component array (no ID needed)
  { "op": "prepend", "components": [{ "type": "image", "src": "/assets/logo.png" }] },
  { "op": "append", "components": [{ "type": "callout", "body": "Footer note" }] },

  // Update page-level fields
  { "op": "set_field", "field": "title", "value": "New Title" },
  { "op": "set_field", "field": "subtitle", "value": "May 2026" },
  { "op": "set_field", "field": "eyebrow", "value": "Reports" }
]
```

**Server flow:**
1. Parse stored YAML for the page
2. Check `expected_hash` — reject 409 if stale
3. Run `ensureComponentIds` on parsed components
4. Apply operations sequentially (replace/insert/remove mutate the components array; set_field mutates page-level fields)
5. Run `ensureComponentIds` again on result (new components from patches get IDs)
6. Serialize back to YAML
7. Validate via existing `validateContent` + `checkUnsupportedComponents`
8. Save via existing `writePage`
9. Return new content hash

**Error handling:**
- Unknown `id` in an operation → error with message listing available IDs
- `expected_hash` mismatch → 409 with current hash so agent can re-read
- Validation failure after patch → error (patch not saved), return validation errors

### Agent Prompt Update

Add `patch_page` to the tools table in `agent-prompt.ts` and add guidance:

> **Prefer `patch_page` over `write_page` for partial updates.** When you need to update a single section, add a component, or change the page title, use `patch_page` with targeted operations. Only use `write_page` when rewriting the majority of the page content. Every `read_page` response includes auto-generated `id` fields on top-level components — use these as patch targets.

Update the workflow steps to mention `patch_page` as the preferred path for incremental updates.

### MCP Streaming Registration

Add `patch_page` tool schema to `stream/route.ts` so it appears in MCP tool discovery with proper parameter descriptions.

## Files Changed

| File | Change |
|------|--------|
| `src/lib/pages.ts` | Add `ensureComponentIds()` function. Call it inside `writePage` before storing. |
| `src/app/api/mcp/route.ts` | Add `patch_page` to `WRITE_TOOLS` and `dispatch`. Enrich `read_page` response with `ensureComponentIds`. |
| `src/app/api/mcp/stream/route.ts` | Register `patch_page` tool schema for MCP streaming. |
| `src/lib/agent-prompt.ts` | Add `patch_page` to tools table + usage guidance. |

## Not in Scope

- Nested component IDs (only top-level components get IDs)
- Batch operations across multiple pages
- Undo/revert for patches (version history already exists via `get_versions`)
- Backfill migration (approach C makes this unnecessary — IDs appear on next read)
