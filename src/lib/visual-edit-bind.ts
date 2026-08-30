// Attribute-driven binding between page data and the DOM kazam rendered.
//
// The kazam renderer tags what it draws:
//   data-kz-path  on every component root  -> absolute path, e.g. components[2].components[0]
//   data-kz-type  on every component root  -> component type, for schema lookups
//   data-kz-field on every content element -> path relative to its component, e.g. stats[3].value
//   data-kz-block on markdown/code blocks   -> edit the raw source in a multi-line input
//   data-kz-list  on item containers        -> where "+ item" goes
// Curata's own hero adds data-kz-path="" and data-kz-field="title|subtitle".
// No text matching anywhere: if an element is tagged, we know exactly which
// value it shows. The kazam test suite guarantees every content field is tagged.

import { KZ_SCHEMA, kzResolveField, kzElemType, kzEmptyItem, kzTitle, type KzField, type KzKind } from "@/generated/kazam-renderer";

export type Path = Array<string | number>;

export interface Binding {
  /** Absolute path into the bound data object. */
  path: Path;
  /** Last path segment, for labels. */
  key: string;
  kind: KzKind;
  /** The tagged element (hit target). */
  el: Element;
  /** First non-empty text node inside `el`, for font sampling and tight input placement. */
  textNode: Text | null;
  /** Multi-line raw editing (markdown / code). */
  block: boolean;
}

export interface ListTarget {
  /** Absolute path of the array. */
  path: Path;
  el: Element;
  componentType: string;
  field: KzField | null;
  /** Human label for the affordance, e.g. "Stat", "Row", "Card". */
  itemLabel: string;
  /** Build a new item for this list from the current data. */
  makeItem: (data: Record<string, unknown>) => Record<string, unknown>;
  /** Relative field to focus on the new item, if any. */
  focusField: string | null;
}

export interface MissingField {
  path: Path;
  key: string;
  text: string;
}

export function getAt(obj: unknown, path: Path): unknown {
  let cur: unknown = obj;
  for (const seg of path) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string | number, unknown>)[seg];
  }
  return cur;
}

/** Immutable set: clones every container along the path. */
export function setAt<T>(obj: T, path: Path, value: unknown): T {
  if (path.length === 0) return value as T;
  const [head, ...rest] = path;
  const clone: unknown = Array.isArray(obj) ? [...(obj as unknown[])] : { ...(obj as Record<string, unknown>) };
  (clone as Record<string | number, unknown>)[head] = setAt((obj as Record<string | number, unknown>)?.[head], rest, value);
  return clone as T;
}

export function pathLabel(path: Path): string {
  return path.map((s, i) => (typeof s === "number" ? `[${s}]` : i === 0 ? s : `.${s}`)).join("");
}

/** `components[2].stats[3].value` -> ["components", 2, "stats", 3, "value"] */
export function parsePath(str: string): Path {
  const out: Path = [];
  for (const tok of str.match(/[^.[\]]+|\[\d+\]/g) || []) {
    if (tok.startsWith("[")) out.push(Number(tok.slice(1, -1)));
    else out.push(tok);
  }
  return out;
}

export function joinPath(base: string, rel: string): string {
  if (!base) return rel;
  if (!rel) return base;
  return rel.startsWith("[") ? `${base}${rel}` : `${base}.${rel}`;
}

function firstTextNode(el: Element): Text | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeValue && n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  return walker.nextNode() as Text | null;
}

const CONTENT = new Set<KzKind>(["text", "markdown", "code", "number"]);

function componentRootOf(el: Element): { base: string; type: string | null } {
  const root = el.closest<HTMLElement>("[data-kz-path]");
  return { base: root?.getAttribute("data-kz-path") ?? "", type: root?.getAttribute("data-kz-type") ?? null };
}

function kindFor(type: string | null, rel: string, value: unknown): KzKind {
  const f = type ? kzResolveField(type, rel) : null;
  if (f) return f.kind;
  return typeof value === "number" ? "number" : "text";
}

/** Fill required content strings so a brand-new item renders something clickable. */
function seedItem(item: Record<string, unknown>, typeName: string): Record<string, unknown> {
  const fields = KZ_SCHEMA.types[typeName] || [];
  const out = { ...item };
  for (const f of fields) {
    if (f.required && (f.kind === "text" || f.kind === "markdown") && !out[f.name]) out[f.name] = kzTitle(f.name);
  }
  return out;
}

export function bindRoot(root: HTMLElement, data: Record<string, unknown>): { bindings: Binding[]; lists: ListTarget[]; missing: MissingField[] } {
  const bindings: Binding[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-kz-field]"))) {
    const rel = el.getAttribute("data-kz-field") || "";
    if (!rel) continue;
    const { base, type } = componentRootOf(el);
    const path = parsePath(joinPath(base, rel));
    const value = getAt(data, path);
    if (value === undefined || value === null || typeof value === "object" || typeof value === "boolean") continue;
    const kind = kindFor(type, rel, value);
    if (!CONTENT.has(kind)) continue;
    const key = String(path[path.length - 1]);
    bindings.push({
      path,
      key,
      kind,
      el,
      textNode: firstTextNode(el),
      block: el.hasAttribute("data-kz-block") || kind === "markdown" || kind === "code",
    });
  }
  bindings.sort((a, b) => {
    const pos = a.el.compareDocumentPosition(b.el);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });

  const lists: ListTarget[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-kz-list]"))) {
    const name = el.getAttribute("data-kz-list") || "";
    const { base, type } = componentRootOf(el);
    if (!name || !type) continue;
    const path = parsePath(joinPath(base, name));
    const field = (KZ_SCHEMA.components[type] || []).find((f) => f.name === name) ?? null;
    const elem = field ? kzElemType(field.type) : null;
    const compPath = parsePath(base);
    let itemLabel = "Item";
    let makeItem: ListTarget["makeItem"];
    let focusField: string | null = null;
    if (elem && elem.startsWith("Record<")) {
      itemLabel = "Row";
      makeItem = (d) => {
        const cols = (getAt(d, [...compPath, "columns"]) as Array<{ key: string }> | undefined) || [];
        const row: Record<string, unknown> = {};
        cols.forEach((c, i) => { row[c.key] = i === 0 ? "New row" : ""; });
        return row;
      };
      focusField = null; // resolved at add time from columns[0].key
    } else if (elem && KZ_SCHEMA.types[elem]) {
      itemLabel = kzTitle(elem);
      const first = (KZ_SCHEMA.types[elem] || []).find((f) => f.required && CONTENT.has(f.kind)) ?? (KZ_SCHEMA.types[elem] || []).find((f) => CONTENT.has(f.kind));
      focusField = first?.name ?? null;
      makeItem = () => seedItem(kzEmptyItem(elem), elem);
    } else {
      continue;
    }
    lists.push({ path, el, componentType: type, field, itemLabel, makeItem, focusField });
  }

  // Content fields present in data but with no rendered element (renderer gap or hidden state).
  const missing: MissingField[] = [];
  const bound = new Set(bindings.map((b) => pathLabel(b.path)));
  for (const rootEl of Array.from(root.querySelectorAll<HTMLElement>("[data-kz-path][data-kz-type]"))) {
    const base = rootEl.getAttribute("data-kz-path") || "";
    const type = rootEl.getAttribute("data-kz-type") || "";
    const compPath = parsePath(base);
    const comp = getAt(data, compPath) as Record<string, unknown> | undefined;
    if (!comp) continue;
    for (const f of KZ_SCHEMA.components[type] || []) {
      if (!CONTENT.has(f.kind)) continue;
      const v = comp[f.name];
      if (typeof v !== "string" && typeof v !== "number") continue;
      const path = [...compPath, f.name];
      if (!bound.has(pathLabel(path))) missing.push({ path, key: f.name, text: String(v) });
    }
  }

  return { bindings, lists, missing };
}
