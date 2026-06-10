// Per-user pins, stored in localStorage like recents (curata-recent).
// Page.pinned in the DB is the org-wide default: it seeds a user's pin set
// the first time their browser loads the sidebar, after which pin/unpin is
// local to the browser and never touches the server.

const PIN_KEY = "curata-pins";
export const PINS_CHANGED_EVENT = "curata-pins-changed";

/** Raw read; null means this browser has never been seeded. */
export function readPins(): string[] | null {
  try {
    const raw = localStorage.getItem(PIN_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

export function writePins(slugs: string[]): void {
  try {
    localStorage.setItem(PIN_KEY, JSON.stringify(slugs));
  } catch {
    // storage full/unavailable — pins just won't persist
  }
  window.dispatchEvent(new CustomEvent(PINS_CHANGED_EVENT));
}

/** Read pins, seeding from the org-wide pinned set on first load. */
export function readPinsSeeded(orgPinnedSlugs: string[]): string[] {
  const pins = readPins();
  if (pins !== null) return pins;
  writePins(orgPinnedSlugs);
  return orgPinnedSlugs;
}

export function isPinned(slug: string): boolean {
  return (readPins() ?? []).includes(slug);
}

/** Toggle a pin; returns the new pinned state. */
export function togglePin(slug: string): boolean {
  const pins = readPins() ?? [];
  const next = pins.includes(slug) ? pins.filter((s) => s !== slug) : [...pins, slug];
  writePins(next);
  return next.includes(slug);
}
