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
