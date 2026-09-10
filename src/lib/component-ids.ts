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
  const typeName = typeof component.type === "string" && component.type ? component.type : "component";
  return `${typeName}-${index}`;
}

/**
 * Every place a component can hold children. Arrays are returned with a
 * path suffix so callers can build absolute keypaths; grid children are
 * single-component slots (`children[i].component`), not arrays, and are
 * surfaced as one-element arrays plus a flag so ops know they can only
 * replace, not insert beside.
 */
interface NestedList {
  suffix: string;
  arr: Component[];
  /** True for a grid `children[i].component` slot: writes go back through `set`. */
  slot?: { set: (c: Component) => void };
}

function nestedLists(c: Component): NestedList[] {
  const out: NestedList[] = [];
  if (Array.isArray(c.components)) out.push({ suffix: ".components", arr: c.components as Component[] });
  if (Array.isArray(c.items)) {
    (c.items as Component[]).forEach((item, i) => {
      if (Array.isArray(item.components)) out.push({ suffix: `.items[${i}].components`, arr: item.components as Component[] });
    });
  }
  if (Array.isArray(c.tabs)) {
    (c.tabs as Component[]).forEach((tab, i) => {
      if (Array.isArray(tab.components)) out.push({ suffix: `.tabs[${i}].components`, arr: tab.components as Component[] });
    });
  }
  if (Array.isArray(c.columns)) {
    (c.columns as unknown[]).forEach((col, i) => {
      if (Array.isArray(col)) out.push({ suffix: `.columns[${i}]`, arr: col as Component[] });
    });
  }
  if (Array.isArray(c.children)) {
    (c.children as Component[]).forEach((child, i) => {
      if (child && typeof child.component === "object" && child.component !== null) {
        out.push({
          suffix: `.children[${i}].component`,
          arr: [child.component as Component],
          slot: { set: (n) => { child.component = n; } },
        });
      }
    });
  }
  return out;
}

/** Legacy shape kept for callers that only need the arrays. */
function extractNestedArrays(c: Component): Component[][] {
  return nestedLists(c).map((n) => n.arr);
}

function collectUsedIds(components: Component[], usedIds: Set<string>): void {
  for (const c of components) {
    if (typeof c.id === "string" && c.id) usedIds.add(c.id);
    for (const nested of extractNestedArrays(c)) {
      collectUsedIds(nested, usedIds);
    }
  }
}

function stampIds(components: Component[], usedIds: Set<string>): Component[] {
  return components.map((c, i) => {
    let stamped = { ...c };
    if (!(typeof stamped.id === "string" && stamped.id)) {
      let candidate = deriveId(c, i);
      if (usedIds.has(candidate)) {
        let suffix = i;
        while (usedIds.has(`${candidate}-${suffix}`)) suffix++;
        candidate = `${candidate}-${suffix}`;
      }
      usedIds.add(candidate);
      stamped = { ...stamped, id: candidate };
    }
    if (Array.isArray(stamped.components)) {
      stamped = { ...stamped, components: stampIds(stamped.components as Component[], usedIds) };
    }
    if (Array.isArray(stamped.items)) {
      stamped = {
        ...stamped,
        items: (stamped.items as Component[]).map((item) =>
          Array.isArray(item.components)
            ? { ...item, components: stampIds(item.components as Component[], usedIds) }
            : item
        ),
      };
    }
    if (Array.isArray(stamped.tabs)) {
      stamped = {
        ...stamped,
        tabs: (stamped.tabs as Component[]).map((tab) =>
          Array.isArray(tab.components)
            ? { ...tab, components: stampIds(tab.components as Component[], usedIds) }
            : tab
        ),
      };
    }
    if (Array.isArray(stamped.columns)) {
      stamped = {
        ...stamped,
        columns: (stamped.columns as unknown[]).map((col) =>
          Array.isArray(col) ? stampIds(col as Component[], usedIds) : col
        ),
      };
    }
    if (Array.isArray(stamped.children)) {
      stamped = {
        ...stamped,
        children: (stamped.children as Component[]).map((child, ci) =>
          child && typeof child.component === "object" && child.component !== null
            ? { ...child, component: stampIds([child.component as Component], usedIds).map((s) => ({ ...s, id: ensureUniqueChildId(s, usedIds, ci) }))[0] }
            : child
        ),
      };
    }
    return stamped;
  });
}

/** Grid children stamp at index 0 of a one-element list; disambiguate with the child index. */
function ensureUniqueChildId(c: Component, usedIds: Set<string>, childIndex: number): string {
  const id = c.id as string;
  if (!/-0$/.test(id)) return id;
  const base = id.replace(/-0$/, "");
  let candidate = `${base}-${childIndex}`;
  let n = childIndex;
  while (usedIds.has(candidate) && candidate !== id) {
    n++;
    candidate = `${base}-${n}`;
  }
  usedIds.delete(id);
  usedIds.add(candidate);
  return candidate;
}

export function ensureComponentIds(components: Component[]): Component[] {
  const usedIds = new Set<string>();
  collectUsedIds(components, usedIds);
  return stampIds(components, usedIds);
}

/**
 * Recursively collects every explicit `id` set on a components tree
 * (sections, nested `components`/`items[].components`/`tabs[].components`/
 * `columns[]`/grid `children[].component` included) without stamping anything.
 */
export function collectComponentIds(components: Component[]): Set<string> {
  const ids = new Set<string>();
  collectUsedIds(components, ids);
  return ids;
}

// ── Outline and location ──────────────────────────────

export interface OutlineEntry {
  id: string;
  type: string;
  path: string;
  depth: number;
  parentId: string | null;
  label: string | null;
}

function labelOf(c: Component): string | null {
  for (const key of ["heading", "title", "label", "term", "name"]) {
    const v = c[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  if (typeof c.body === "string" && c.body.trim()) {
    const first = c.body.trim().split("\n")[0];
    return first.length > 60 ? `${first.slice(0, 57)}...` : first;
  }
  return null;
}

/** Flat, depth-annotated list of every component. Run ensureComponentIds first. */
export function buildOutline(
  components: Component[],
  pathOf: string | ((i: number) => string) = "components",
  depth = 0,
  parentId: string | null = null
): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  components.forEach((c, i) => {
    const path = typeof pathOf === "string" ? `${pathOf}[${i}]` : pathOf(i);
    const id = typeof c.id === "string" ? c.id : "";
    out.push({ id, type: String(c.type ?? "unknown"), path, depth, parentId, label: labelOf(c) });
    for (const n of nestedLists(c)) {
      const childPath = n.slot ? () => `${path}${n.suffix}` : `${path}${n.suffix}`;
      out.push(...buildOutline(n.arr, childPath, depth + 1, id || null));
    }
  });
  return out;
}

/** One line per component, indented by depth. */
export function formatOutline(entries: OutlineEntry[]): string {
  return entries
    .map((e) => `${"  ".repeat(e.depth)}${e.id || "(no id)"}  ${e.type}${e.label ? `  "${e.label}"` : ""}`)
    .join("\n");
}

export interface Located {
  component: Component;
  path: string;
  parentId: string | null;
  siblings: string[];
  replace: (items: Component[]) => void;
  insertBefore: (items: Component[]) => void;
  insertAfter: (items: Component[]) => void;
  remove: () => void;
}

function locateIn(
  components: Component[],
  id: string,
  pathOf: string | ((i: number) => string),
  parentId: string | null,
  slot?: NestedList["slot"]
): Located | null {
  for (let i = 0; i < components.length; i++) {
    const c = components[i];
    const path = typeof pathOf === "string" ? `${pathOf}[${i}]` : pathOf(i);
    if (c.id === id) {
      const siblings = components.map((s) => (typeof s.id === "string" ? s.id : "")).filter(Boolean);
      if (slot) {
        const only = (items: Component[]) => {
          if (items.length !== 1) throw new Error(`grid child "${id}" holds exactly one component; got ${items.length}`);
          return items[0];
        };
        const noInsert = () => {
          throw new Error(`"${id}" is a grid child; insert beside it by editing the grid's children instead`);
        };
        return {
          component: c,
          path,
          parentId,
          siblings,
          replace: (items) => slot.set(only(items)),
          insertBefore: noInsert,
          insertAfter: noInsert,
          remove: noInsert,
        };
      }
      return {
        component: c,
        path,
        parentId,
        siblings,
        replace: (items) => components.splice(i, 1, ...items),
        insertBefore: (items) => components.splice(i, 0, ...items),
        insertAfter: (items) => components.splice(i + 1, 0, ...items),
        remove: () => components.splice(i, 1),
      };
    }
    for (const n of nestedLists(c)) {
      const childPath = n.slot ? () => `${path}${n.suffix}` : `${path}${n.suffix}`;
      const found = locateIn(n.arr, id, childPath, typeof c.id === "string" ? c.id : null, n.slot);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Find a component anywhere in the tree by id. Also accepts a section's
 * heading slug and the `c-<n>` / `<type>-<n>` index forms read_page shows.
 * Returns handles that mutate `components` in place.
 */
export function locateComponent(components: Component[], id: string): Located | null {
  const direct = locateIn(components, id, "components", null);
  if (direct) return direct;
  const indexMatch = id.match(/^c-(\d+)$/);
  if (indexMatch) {
    const idx = parseInt(indexMatch[1], 10);
    if (idx >= 0 && idx < components.length) {
      const target = components[idx];
      const tid = typeof target.id === "string" ? target.id : "";
      if (tid) return locateIn(components, tid, "components", null);
    }
  }
  const slug = toKebab(id);
  if (slug && slug !== id) return locateIn(components, slug, "components", null);
  return null;
}

// ── Patch operations ──────────────────────────────────

export interface PatchOperation {
  op: "replace" | "insert_before" | "insert_after" | "remove" | "prepend" | "append" | "set_field";
  id?: string;
  components?: Component[];
  field?: string;
  value?: unknown;
}

interface PageObject {
  components: Component[];
  [key: string]: unknown;
}

function resolveComponents(op: PatchOperation): Component[] {
  if (Array.isArray(op.components) && op.components.length > 0) return op.components;
  if (op.value != null && typeof op.value === "object" && !Array.isArray(op.value)) return [op.value as Component];
  if (Array.isArray(op.value) && op.value.length > 0) return op.value as Component[];
  return [];
}

function notFound(id: string | undefined, op: string, components: Component[]): Error {
  const entries = buildOutline(components);
  const available = entries.map((e) => e.id).filter(Boolean).join(", ");
  const outline = formatOutline(entries);
  if (!id) return new Error(`"${op}" requires an "id" field specifying which component to target. Available IDs: ${available}\nPage outline (id  type  label):\n${outline}`);
  return new Error(`Component ID "${id}" not found. available IDs: ${available}\nPage outline (id  type  label):\n${outline}`);
}

export function applyPatchOperations(page: PageObject, operations: PatchOperation[]): PageObject {
  // Deep clone so in-place splices never touch the caller's object.
  const result: PageObject = JSON.parse(JSON.stringify({ ...page, components: page.components }));

  for (const op of operations) {
    const items = resolveComponents(op);
    const needItems = () => {
      if (items.length === 0) throw new Error(`"${op.op}" requires components or value, but none were provided`);
    };
    const target = () => {
      if (!op.id) throw notFound(undefined, op.op, result.components);
      const loc = locateComponent(result.components, op.id);
      if (!loc) throw notFound(op.id, op.op, result.components);
      return loc;
    };

    switch (op.op) {
      case "replace": {
        const loc = target();
        needItems();
        loc.replace(items);
        break;
      }
      case "insert_before": {
        const loc = target();
        needItems();
        loc.insertBefore(items);
        break;
      }
      case "insert_after": {
        const loc = target();
        needItems();
        loc.insertAfter(items);
        break;
      }
      case "remove": {
        target().remove();
        break;
      }
      case "prepend": {
        needItems();
        result.components = [...items, ...result.components];
        break;
      }
      case "append": {
        needItems();
        result.components = [...result.components, ...items];
        break;
      }
      case "set_field": {
        if (!op.field) throw new Error("set_field requires a field name");
        const allowed = ["title", "subtitle", "eyebrow", "shell"];
        if (!allowed.includes(op.field)) throw new Error(`set_field: "${op.field}" is not an allowed field (${allowed.join(", ")})`);
        result[op.field] = op.value;
        break;
      }
      default:
        throw new Error(`Unknown op: "${(op as PatchOperation).op}"`);
    }
  }

  return result;
}
