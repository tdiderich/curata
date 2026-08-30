"use client";

// Client-side registry connecting the page a user is viewing to the command
// palette and the floating action dock. The page detail view registers its
// actions on mount; the palette reads them when it opens and lists them above
// search results; the dock renders them inline. An event keeps an already-open
// palette in sync when navigation swaps the page.

export type PageActionIcon =
  | "copy"
  | "edit"
  | "check"
  | "save"
  | "present"
  | "pdf"
  | "discard"
  | "settings"
  | "folder"
  | "report"
  | "broom"
  | "clock"
  | "zap"
  | "plus";

export interface PageAction {
  id: string;
  label: string;
  hint?: string;
  /** Icon shown in the floating dock. Palette ignores it. */
  icon?: PageActionIcon;
  /** Render as the emphasized action in the dock (e.g. "Save edits"). */
  primary?: boolean;
  /** When set, the dock renders a menu of these instead of running `run`. */
  children?: PageAction[];
  run: () => void;
}

let current: PageAction[] = [];

export function registerPageActions(actions: PageAction[]): () => void {
  current = actions;
  window.dispatchEvent(new Event("curata-page-actions"));
  return () => {
    if (current === actions) {
      current = [];
      window.dispatchEvent(new Event("curata-page-actions"));
    }
  };
}

export function getPageActions(): PageAction[] {
  return current;
}
