"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

interface HighlightTarget {
  id: string;
  text: string;
  section?: string;
}

interface HighlightPositions {
  positions: Map<string, number>;
  ranges: Map<string, Range>;
}

const CSS_HIGHLIGHT_NAME = "ann-highlight";
const supportsHighlightAPI = typeof CSS !== "undefined" && "highlights" in CSS;

function findTextRange(
  root: HTMLElement,
  target: string,
  scope?: string,
): Range | null {
  const containers = scope
    ? Array.from(root.querySelectorAll(scope))
    : [root];

  for (const container of containers) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let textNode: Text | null;
    while ((textNode = walker.nextNode() as Text | null)) {
      const content = textNode.textContent || "";
      const idx = content.indexOf(target);
      if (idx === -1) continue;
      if (textNode.parentElement?.closest("svg")) continue;

      try {
        const range = document.createRange();
        range.setStart(textNode, idx);
        range.setEnd(textNode, idx + target.length);
        return range;
      } catch {
        continue;
      }
    }
  }
  return null;
}

function findSectionTop(root: HTMLElement, sectionName: string): number | null {
  const headings = root.querySelectorAll(".c-section-heading");
  for (const h of headings) {
    if (h.textContent?.trim() === sectionName) {
      const section = h.closest(".c-section");
      if (section) {
        const rootRect = root.getBoundingClientRect();
        const sectionRect = section.getBoundingClientRect();
        return sectionRect.top - rootRect.top;
      }
    }
  }
  return null;
}

export function useHighlights(
  rootRef: RefObject<HTMLElement | null>,
  targets: HighlightTarget[],
  options: { expandAll?: boolean; isDeck?: boolean } = {},
): HighlightPositions {
  const [positions, setPositions] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [ranges, setRanges] = useState<Map<string, Range>>(() => new Map());
  const fallbackRef = useRef<HTMLDivElement[]>([]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    cleanupFallback(fallbackRef.current);
    fallbackRef.current = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const highlight = supportsHighlightAPI ? new (window as Record<string, any>).Highlight() : null;
    const newPositions = new Map<string, number>();
    const newRanges = new Map<string, Range>();
    const scope = options.isDeck ? ".deck-inner" : undefined;

    for (const t of targets) {
      let y: number | null = null;

      if (t.text) {
        const range = findTextRange(root, t.text, scope);
        if (range) {
          newRanges.set(t.id, range);
          if (highlight) highlight.add(range);

          const rootRect = root.getBoundingClientRect();
          const rangeRect = range.getBoundingClientRect();
          y = rangeRect.top - rootRect.top;

          if (!supportsHighlightAPI) {
            const overlay = createFallbackOverlay(root, rangeRect, rootRect, t.id);
            fallbackRef.current.push(overlay);
          }
        }
      }

      if (y === null && t.section) {
        y = findSectionTop(root, t.section);
      }
      newPositions.set(t.id, y ?? 40);
    }

    const sorted = [...newPositions.entries()].sort((a, b) => a[1] - b[1]);
    const MIN_GAP = options.expandAll ? 120 : 36;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i][1] - sorted[i - 1][1] < MIN_GAP) {
        sorted[i][1] = sorted[i - 1][1] + MIN_GAP;
        newPositions.set(sorted[i][0], sorted[i][1]);
      }
    }

    if (supportsHighlightAPI) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (CSS as Record<string, any>).highlights.set(CSS_HIGHLIGHT_NAME, highlight);
    }

    setRanges(newRanges);
    setPositions(newPositions);

    return () => {
      if (supportsHighlightAPI) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (CSS as Record<string, any>).highlights.delete(CSS_HIGHLIGHT_NAME);
      }
      cleanupFallback(fallbackRef.current);
      fallbackRef.current = [];
    };
  }, [rootRef, targets, options.expandAll, options.isDeck]);

  return { positions, ranges };
}

function createFallbackOverlay(
  root: HTMLElement,
  rangeRect: DOMRect,
  rootRect: DOMRect,
  annId: string,
): HTMLDivElement {
  const div = document.createElement("div");
  div.className = "ann-highlight-overlay";
  div.dataset.ann = annId;
  div.style.position = "absolute";
  div.style.left = `${rangeRect.left - rootRect.left}px`;
  div.style.top = `${rangeRect.top - rootRect.top}px`;
  div.style.width = `${rangeRect.width}px`;
  div.style.height = `${rangeRect.height}px`;
  div.style.pointerEvents = "auto";
  div.style.cursor = "pointer";
  root.style.position = "relative";
  root.appendChild(div);
  return div;
}

function cleanupFallback(divs: HTMLDivElement[]) {
  for (const d of divs) d.remove();
}
