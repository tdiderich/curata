# patch_page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add auto-generated component IDs and a `patch_page` MCP tool so agents can make partial page updates without rewriting full YAML.

**Architecture:** Pure `ensureComponentIds()` function stamps deterministic IDs on top-level components. Runs on both read (ephemeral gap-fill) and write (persist). New `patch_page` tool parses stored YAML, applies targeted operations by component ID, validates, and saves.

**Tech Stack:** TypeScript, vitest, js-yaml, zod (MCP streaming), Prisma

---

### Task 1: `ensureComponentIds` — pure function + tests

**Files:**
- Create: `src/lib/component-ids.ts`
- Create: `tests/component-ids.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// tests/component-ids.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/tyler/personal-repos/curata && pnpm test -- tests/component-ids.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/component-ids.ts

type Component = Record<string, unknown>;

function toKebab(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function deriveId(component: Component, index: number): string {
  if (component.type === "section") {
    const parts: string[] = [];
    if (typeof component.eyebrow === "string" && component.eyebrow) parts.push(component.eyebrow);
    if (typeof component.heading === "string" && component.heading) parts.push(component.heading);
    if (parts.length > 0) return toKebab(parts.join(" "));
  }
  return `${component.type}-${index}`;
}

export function ensureComponentIds(components: Component[]): Component[] {
  const usedIds = new Set<string>();

  // First pass: collect existing user-authored IDs
  for (const c of components) {
    if (typeof c.id === "string" && c.id) {
      usedIds.add(c.id);
    }
  }

  // Second pass: generate IDs for components that lack them
  return components.map((c, i) => {
    if (typeof c.id === "string" && c.id) return { ...c };

    let candidate = deriveId(c, i);
    if (usedIds.has(candidate)) {
      candidate = `${candidate}-${i}`;
    }
    usedIds.add(candidate);
    return { ...c, id: candidate };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/tyler/personal-repos/curata && pnpm test -- tests/component-ids.test.ts`
Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/tyler/personal-repos/curata && git add src/lib/component-ids.ts tests/component-ids.test.ts && git commit -m "feat: add ensureComponentIds utility for stable component targeting"
```

---

### Task 2: Wire `ensureComponentIds` into write path

**Files:**
- Modify: `src/lib/pages.ts` — `writePage` function (lines 239-251)
- Modify: `tests/pages.test.ts` — add test

- [ ] **Step 1: Add test for ID stamping on write**

Add this test to the `writePage` describe block in `tests/pages.test.ts`:

```typescript
it("stamps component IDs on save", async () => {
  const yamlContent = `title: ID Test
shell: standard
components:
- type: section
  eyebrow: Topic 1
  heading: My Section
  components: []
- type: divider
`;
  const result = await writePage(orgId, orgSlug, "id-stamp-page", yamlContent, "user1");
  expect(result.ok).toBe(true);

  const read = await readPageYaml(orgId, "id-stamp-page");
  expect(read).not.toBeNull();
  expect(read!.yaml).toContain("id: topic-1-my-section");
  expect(read!.yaml).toContain("id: divider-1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/tyler/personal-repos/curata && pnpm test -- tests/pages.test.ts -t "stamps component IDs on save"`
Expected: FAIL — yaml doesn't contain IDs yet

- [ ] **Step 3: Modify `writePage` to stamp IDs before storing**

In `src/lib/pages.ts`, add the import at the top:

```typescript
import { ensureComponentIds } from "./component-ids";
```

Replace the `writePage` function (lines 239-251) with:

```typescript
export async function writePage(
  orgId: string,
  orgSlug: string,
  slug: string,
  content: string,
  createdBy: string,
  expectedHash?: string,
  sortOrder?: number | null
): Promise<{ ok: true; slug: string; contentHash: string } | { ok: false; error: string }> {
  let jsonContent = (parseYamlToJson(content) ?? undefined) as Record<string, unknown> | undefined;
  let yamlContent = content;

  if (jsonContent && Array.isArray(jsonContent.components)) {
    jsonContent = { ...jsonContent, components: ensureComponentIds(jsonContent.components as Record<string, unknown>[]) };
    yamlContent = yaml.dump(jsonContent, { lineWidth: -1, noRefs: true });
  }

  const title = (jsonContent?.title as string) || extractTitle(content, slug);
  return _writePageInternal(orgId, orgSlug, slug, yamlContent, jsonContent as Prisma.InputJsonValue | undefined, title, createdBy, expectedHash, sortOrder);
}
```

- [ ] **Step 4: Run full pages test suite**

Run: `cd /Users/tyler/personal-repos/curata && pnpm test -- tests/pages.test.ts`
Expected: All tests PASS (including new one)

- [ ] **Step 5: Commit**

```bash
cd /Users/tyler/personal-repos/curata && git add src/lib/pages.ts tests/pages.test.ts && git commit -m "feat: stamp component IDs on page save"
```

---

### Task 3: Wire `ensureComponentIds` into read path (both route files)

**Files:**
- Modify: `src/app/api/mcp/route.ts` — `read_page` dispatch case (lines 131-143)
- Modify: `src/app/api/mcp/stream/route.ts` — `read_page` tool (lines 64-71)

- [ ] **Step 1: Update `read_page` in `route.ts`**

Add import at top of `src/app/api/mcp/route.ts`:

```typescript
import { ensureComponentIds } from "@/lib/component-ids";
```

Replace the `read_page` case (lines 131-143) with:

```typescript
    case "read_page": {
      if (!args.slug) throw new Error("slug is required");
      if (!SLUG_RE.test(args.slug)) throw new Error("invalid slug format");
      const result = await readPageYaml(orgId, args.slug);
      if (!result) throw new Error(`page not found: ${args.slug}`);

      // Enrich with auto-generated IDs for patch targeting
      const parsed = yaml.load(result.yaml) as Record<string, unknown>;
      if (Array.isArray(parsed.components)) {
        parsed.components = ensureComponentIds(parsed.components as Record<string, unknown>[]);
        result.yaml = yaml.dump(parsed, { lineWidth: -1, noRefs: true });
      }

      const sections = await getPageSections(orgId, args.slug);
      const annotations = await getAnnotations(orgId, args.slug);
      return {
        slug: args.slug,
        yaml: result.yaml,
        contentHash: result.contentHash,
        sections,
        annotations,
      };
    }
```

Add `yaml` import at top if not already present:

```typescript
import yaml from "js-yaml";
```

- [ ] **Step 2: Update `read_page` in `stream/route.ts`**

Add import at top of `src/app/api/mcp/stream/route.ts`:

```typescript
import { ensureComponentIds } from "@/lib/component-ids";
import yaml from "js-yaml";
```

Replace the `read_page` tool handler (lines 64-71) with:

```typescript
  server.tool("read_page", "Read a page by slug", { slug: z.string() }, async ({ slug }) => {
    validateSlug(slug);
    const result = await readPageYaml(orgId, slug);
    if (!result) return { content: [{ type: "text", text: `Error: page not found: ${slug}` }], isError: true };

    // Enrich with auto-generated IDs for patch targeting
    const parsed = yaml.load(result.yaml) as Record<string, unknown>;
    if (Array.isArray(parsed.components)) {
      parsed.components = ensureComponentIds(parsed.components as Record<string, unknown>[]);
      result.yaml = yaml.dump(parsed, { lineWidth: -1, noRefs: true });
    }

    const sections = await getPageSections(orgId, slug);
    const annotations = await getAnnotations(orgId, slug);
    return { content: [{ type: "text", text: JSON.stringify({ slug, yaml: result.yaml, contentHash: result.contentHash, sections, annotations }, null, 2) }] };
  });
```

- [ ] **Step 3: Commit**

```bash
cd /Users/tyler/personal-repos/curata && git add src/app/api/mcp/route.ts src/app/api/mcp/stream/route.ts && git commit -m "feat: enrich read_page responses with auto-generated component IDs"
```

---

### Task 4: `applyPatchOperations` — pure function + tests

**Files:**
- Modify: `src/lib/component-ids.ts` — add `applyPatchOperations`
- Modify: `tests/component-ids.test.ts` — add tests

- [ ] **Step 1: Add patch operation tests**

Append to `tests/component-ids.test.ts`:

```typescript
import { applyPatchOperations } from "@/lib/component-ids";

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/tyler/personal-repos/curata && pnpm test -- tests/component-ids.test.ts -t "applyPatchOperations"`
Expected: FAIL — function not exported

- [ ] **Step 3: Implement `applyPatchOperations`**

Add to the bottom of `src/lib/component-ids.ts`:

```typescript
export interface PatchOperation {
  op: "replace" | "insert_before" | "insert_after" | "remove" | "prepend" | "append" | "set_field";
  id?: string;
  components?: Component[];
  field?: string;
  value?: string;
}

interface PageObject {
  components: Component[];
  [key: string]: unknown;
}

function findIndex(components: Component[], id: string): number {
  const idx = components.findIndex((c) => c.id === id);
  if (idx === -1) {
    const available = components.map((c) => c.id).filter(Boolean).join(", ");
    throw new Error(`Component ID "${id}" not found. Available IDs: ${available}`);
  }
  return idx;
}

export function applyPatchOperations(page: PageObject, operations: PatchOperation[]): PageObject {
  let result: PageObject = { ...page, components: [...page.components] };

  for (const op of operations) {
    switch (op.op) {
      case "replace": {
        const idx = findIndex(result.components, op.id!);
        result.components = [
          ...result.components.slice(0, idx),
          ...(op.components || []),
          ...result.components.slice(idx + 1),
        ];
        break;
      }
      case "insert_before": {
        const idx = findIndex(result.components, op.id!);
        result.components = [
          ...result.components.slice(0, idx),
          ...(op.components || []),
          ...result.components.slice(idx),
        ];
        break;
      }
      case "insert_after": {
        const idx = findIndex(result.components, op.id!);
        result.components = [
          ...result.components.slice(0, idx + 1),
          ...(op.components || []),
          ...result.components.slice(idx + 1),
        ];
        break;
      }
      case "remove": {
        const idx = findIndex(result.components, op.id!);
        result.components = [
          ...result.components.slice(0, idx),
          ...result.components.slice(idx + 1),
        ];
        break;
      }
      case "prepend": {
        result.components = [...(op.components || []), ...result.components];
        break;
      }
      case "append": {
        result.components = [...result.components, ...(op.components || [])];
        break;
      }
      case "set_field": {
        if (!op.field) throw new Error("set_field requires a field name");
        const allowed = ["title", "subtitle", "eyebrow", "shell"];
        if (!allowed.includes(op.field)) throw new Error(`set_field: "${op.field}" is not an allowed field (${allowed.join(", ")})`);
        result = { ...result, [op.field]: op.value };
        break;
      }
      default:
        throw new Error(`Unknown op: "${(op as PatchOperation).op}"`);
    }
  }

  return result;
}
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/tyler/personal-repos/curata && pnpm test -- tests/component-ids.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/tyler/personal-repos/curata && git add src/lib/component-ids.ts tests/component-ids.test.ts && git commit -m "feat: add applyPatchOperations for targeted component mutations"
```

---

### Task 5: Add `patch_page` to REST MCP route

**Files:**
- Modify: `src/app/api/mcp/route.ts`

- [ ] **Step 1: Add import**

Add at top of `src/app/api/mcp/route.ts`:

```typescript
import { ensureComponentIds, applyPatchOperations } from "@/lib/component-ids";
import type { PatchOperation } from "@/lib/component-ids";
```

(The `yaml` import was already added in Task 3.)

- [ ] **Step 2: Register `patch_page` as a write tool**

Change line 31:

```typescript
const WRITE_TOOLS = ["write_page", "create_page", "delete_page", "move_page", "annotate_page", "update_annotation", "patch_page"];
```

- [ ] **Step 3: Add `patch_page` dispatch case**

Add this case inside the `dispatch` switch, before `default`:

```typescript
    case "patch_page": {
      if (!args.slug) throw new Error("slug is required");
      if (!SLUG_RE.test(args.slug)) throw new Error("invalid slug format");
      if (!args.expected_hash) throw new Error("expected_hash is required");
      if (!args.operations) throw new Error("operations (JSON array) is required");

      let operations: PatchOperation[];
      try {
        operations = JSON.parse(args.operations);
      } catch {
        throw new Error("operations must be valid JSON");
      }
      if (!Array.isArray(operations)) throw new Error("operations must be an array");

      const current = await readPageYaml(orgId, args.slug);
      if (!current) throw new Error(`page not found: ${args.slug}`);

      if (current.contentHash !== args.expected_hash) {
        throw new Error(`conflict: page was modified since last read (current hash: ${current.contentHash})`);
      }

      const parsed = yaml.load(current.yaml) as Record<string, unknown>;
      if (!Array.isArray(parsed.components)) {
        throw new Error("page has no components array — use write_page instead");
      }

      parsed.components = ensureComponentIds(parsed.components as Record<string, unknown>[]);
      const patched = applyPatchOperations(parsed as { components: Record<string, unknown>[]; [k: string]: unknown }, operations);
      patched.components = ensureComponentIds(patched.components);

      const newYaml = yaml.dump(patched, { lineWidth: -1, noRefs: true });

      const patchUnsupported = checkUnsupportedComponents(newYaml);
      if (patchUnsupported.length > 0) {
        throw new Error(patchUnsupported.map((e) => e.message).join("; "));
      }
      const patchValidation = await validateContent(orgSlug, args.slug, newYaml);
      if (patchValidation.length > 0) {
        throw new Error(`invalid after patch: ${patchValidation.map((e) => e.message).join("; ")}`);
      }

      const patchResult = await writePage(orgId, orgSlug, args.slug, newYaml, "agent", current.contentHash);
      if (!patchResult.ok) throw new Error(patchResult.error);

      logAudit({
        orgId,
        action: "page.patch",
        resourceType: "page",
        resourceId: args.slug,
        actorType: "apikey",
        actorId,
        metadata: { slug: args.slug, operationCount: operations.length },
      });
      return patchResult;
    }
```

- [ ] **Step 4: Commit**

```bash
cd /Users/tyler/personal-repos/curata && git add src/app/api/mcp/route.ts && git commit -m "feat: add patch_page to REST MCP route"
```

---

### Task 6: Add `patch_page` to MCP streaming route

**Files:**
- Modify: `src/app/api/mcp/stream/route.ts`

- [ ] **Step 1: Add imports**

Add at top of `src/app/api/mcp/stream/route.ts` (some may already exist from Task 3):

```typescript
import { ensureComponentIds, applyPatchOperations } from "@/lib/component-ids";
import type { PatchOperation } from "@/lib/component-ids";
```

- [ ] **Step 2: Register the `patch_page` tool**

Add this tool registration inside `createMcpServer`, after the `write_page` tool:

```typescript
  server.tool("patch_page", "Apply targeted operations to a page without rewriting full YAML. Requires component IDs from read_page.",
    {
      slug: z.string().describe("Page slug"),
      expected_hash: z.string().describe("Content hash from last read_page — rejects if page was modified"),
      operations: z.string().describe("JSON array of patch operations: replace, insert_before, insert_after, remove, prepend, append, set_field"),
    },
    async ({ slug, expected_hash, operations: opsJson }) => {
      validateSlug(slug);

      let operations: PatchOperation[];
      try {
        operations = JSON.parse(opsJson);
      } catch {
        return { content: [{ type: "text", text: "Error: operations must be valid JSON" }], isError: true };
      }
      if (!Array.isArray(operations)) {
        return { content: [{ type: "text", text: "Error: operations must be an array" }], isError: true };
      }

      const current = await readPageYaml(orgId, slug);
      if (!current) return { content: [{ type: "text", text: `Error: page not found: ${slug}` }], isError: true };

      if (current.contentHash !== expected_hash) {
        return { content: [{ type: "text", text: `Error: conflict — page modified since last read (current hash: ${current.contentHash})` }], isError: true };
      }

      const parsed = yaml.load(current.yaml) as Record<string, unknown>;
      if (!Array.isArray(parsed.components)) {
        return { content: [{ type: "text", text: "Error: page has no components array — use write_page instead" }], isError: true };
      }

      try {
        parsed.components = ensureComponentIds(parsed.components as Record<string, unknown>[]);
        const patched = applyPatchOperations(parsed as { components: Record<string, unknown>[]; [k: string]: unknown }, operations);
        patched.components = ensureComponentIds(patched.components);

        const newYaml = yaml.dump(patched, { lineWidth: -1, noRefs: true });

        const unsupported = checkUnsupportedComponents(newYaml);
        if (unsupported.length > 0) return { content: [{ type: "text", text: `Error: ${unsupported.map((e) => e.message).join("; ")}` }], isError: true };
        const validationErrors = await validateContent(orgSlug, slug, newYaml);
        if (validationErrors.length > 0) return { content: [{ type: "text", text: `Error: invalid after patch: ${validationErrors.map((e) => e.message).join("; ")}` }], isError: true };

        const result = await writePage(orgId, orgSlug, slug, newYaml, "agent", current.contentHash);
        if (!result.ok) return { content: [{ type: "text", text: `Error: ${result.error}` }], isError: true };

        logAudit({ orgId, action: "page.patch", resourceType: "page", resourceId: slug, actorType: "apikey", actorId, metadata: { slug, operationCount: operations.length } });
        return { content: [{ type: "text", text: `Patched "${slug}" (${operations.length} operations applied)` }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
      }
    });
```

- [ ] **Step 3: Commit**

```bash
cd /Users/tyler/personal-repos/curata && git add src/app/api/mcp/stream/route.ts && git commit -m "feat: add patch_page to MCP streaming route"
```

---

### Task 7: Update agent prompt

**Files:**
- Modify: `src/lib/agent-prompt.ts`

- [ ] **Step 1: Add `patch_page` to the tools table**

In `src/lib/agent-prompt.ts`, find the tools table (around line 96-106) and add a row after `write_page`:

```
| patch_page | write | Apply targeted operations without rewriting full YAML. Args: \`slug\`, \`expected_hash\`, \`operations\` (JSON array) |
```

- [ ] **Step 2: Add usage guidance**

After the tools table (after the closing `|` row), add:

```
**Prefer \`patch_page\` over \`write_page\` for partial updates.** When you need to update a single section, add a component, or change the page title, use \`patch_page\` with targeted operations. Only use \`write_page\` when rewriting the majority of the page content. Every \`read_page\` response includes auto-generated \`id\` fields on top-level components — use these as patch targets.

Operations: \`replace\` (swap component by ID), \`insert_before\`/\`insert_after\` (add relative to ID), \`remove\` (delete by ID), \`prepend\`/\`append\` (add to start/end), \`set_field\` (update title/subtitle/eyebrow/shell).
```

- [ ] **Step 3: Update workflow steps to mention patch_page**

In both workflow variants (slug-specific starting ~line 16, and general starting ~line 37), update step 6/7 ("Draft updates" / "Write the page") to:

```
6. **Apply updates** — for partial changes (updating one section, adding a component, changing the title), use \`patch_page\` with the \`contentHash\` from your \`read_page\` call. For full rewrites, use \`write_page\`.
```

- [ ] **Step 4: Commit**

```bash
cd /Users/tyler/personal-repos/curata && git add src/lib/agent-prompt.ts && git commit -m "docs: add patch_page to agent prompt and prefer it for partial updates"
```

---

### Task 8: Run full test suite + manual smoke test

- [ ] **Step 1: Run full test suite**

Run: `cd /Users/tyler/personal-repos/curata && pnpm test`
Expected: All tests PASS

- [ ] **Step 2: Verify no TypeScript errors**

Run: `cd /Users/tyler/personal-repos/curata && pnpm tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Smoke test (if dev server available)**

Start the dev server and verify:
1. `read_page` for any existing page returns components with `id` fields
2. `patch_page` with a `set_field` operation updates the title
3. `patch_page` with a wrong `expected_hash` returns a conflict error
4. `patch_page` with an unknown component ID returns an error listing available IDs
