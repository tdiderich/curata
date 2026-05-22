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

export function ensureComponentIds(components: Component[]): Component[] {
  const usedIds = new Set<string>();

  for (const c of components) {
    if (typeof c.id === "string" && c.id) {
      usedIds.add(c.id);
    }
  }

  return components.map((c, i) => {
    if (typeof c.id === "string" && c.id) return { ...c };

    let candidate = deriveId(c, i);
    if (usedIds.has(candidate)) {
      let suffix = i;
      while (usedIds.has(`${candidate}-${suffix}`)) {
        suffix++;
      }
      candidate = `${candidate}-${suffix}`;
    }
    usedIds.add(candidate);
    return { ...c, id: candidate };
  });
}

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

function findIndex(components: Component[], id: string): number {
  const idx = components.findIndex((c) => c.id === id);
  if (idx === -1) {
    const available = components.map((c) => c.id).filter(Boolean).join(", ");
    throw new Error(`Component ID "${id}" not found. available IDs: ${available}`);
  }
  return idx;
}

function resolveComponents(op: PatchOperation): Component[] {
  if (Array.isArray(op.components) && op.components.length > 0) return op.components;
  if (op.value != null && typeof op.value === "object" && !Array.isArray(op.value)) return [op.value as Component];
  if (Array.isArray(op.value) && op.value.length > 0) return op.value as Component[];
  return [];
}

export function applyPatchOperations(page: PageObject, operations: PatchOperation[]): PageObject {
  let result: PageObject = { ...page, components: [...page.components] };

  for (const op of operations) {
    const items = resolveComponents(op);

    switch (op.op) {
      case "replace": {
        const idx = findIndex(result.components, op.id!);
        if (items.length === 0) throw new Error(`"${op.op}" requires components or value, but none were provided`);
        result.components = [
          ...result.components.slice(0, idx),
          ...items,
          ...result.components.slice(idx + 1),
        ];
        break;
      }
      case "insert_before": {
        const idx = findIndex(result.components, op.id!);
        if (items.length === 0) throw new Error(`"${op.op}" requires components or value, but none were provided`);
        result.components = [
          ...result.components.slice(0, idx),
          ...items,
          ...result.components.slice(idx),
        ];
        break;
      }
      case "insert_after": {
        const idx = findIndex(result.components, op.id!);
        if (items.length === 0) throw new Error(`"${op.op}" requires components or value, but none were provided`);
        result.components = [
          ...result.components.slice(0, idx + 1),
          ...items,
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
        if (items.length === 0) throw new Error(`"${op.op}" requires components or value, but none were provided`);
        result.components = [...items, ...result.components];
        break;
      }
      case "append": {
        if (items.length === 0) throw new Error(`"${op.op}" requires components or value, but none were provided`);
        result.components = [...result.components, ...items];
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
