"use client";

// Client-side registry connecting the page a user is viewing to the command
// palette. The page detail view registers its actions on mount; the palette
// reads them when it opens and lists them above search results. An event
// keeps an already-open palette in sync when navigation swaps the page.

export interface PageAction {
  id: string;
  label: string;
  hint?: string;
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
