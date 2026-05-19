"use client";

import { forwardRef, useCallback, useEffect, useRef, useState } from "react";

export interface SelectionAction {
  label: string;
  onSelect: (section: string, selectedText: string) => void;
}

export const PageContent = forwardRef<
  HTMLDivElement,
  {
    children?: React.ReactNode;
    selectionAction?: string;
    selectionActions?: SelectionAction[];
    onTextSelect?: (section: string, selectedText: string) => void;
  }
>(function PageContent({ children, selectionAction, selectionActions, onTextSelect }, forwardedRef) {
  const localRef = useRef<HTMLDivElement>(null);
  const selectedTextRef = useRef("");
  const [selectionPopup, setSelectionPopup] = useState<{
    x: number;
    y: number;
    section: string;
  } | null>(null);

  const hasActions = selectionActions ? selectionActions.length > 0 : !!selectionAction;

  const mergedRef = useCallback(
    (node: HTMLDivElement | null) => {
      localRef.current = node;
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef)
        (forwardedRef as React.MutableRefObject<HTMLDivElement | null>).current =
          node;
    },
    [forwardedRef],
  );

  const handleMouseUp = useCallback(() => {
    if (!hasActions) return;
    const sel = window.getSelection();
    const container = localRef.current;
    if (!sel || sel.isCollapsed || !container) return;

    const text = sel.toString().trim();
    if (!text) return;

    const range = sel.getRangeAt(0);
    let node: Node | null = range.startContainer;
    let sectionEl: HTMLElement | null = null;

    while (node && node !== container) {
      if (node instanceof HTMLElement && node.classList.contains("c-section")) {
        sectionEl = node;
        break;
      }
      node = node.parentNode;
    }

    const heading = sectionEl?.querySelector(".c-section-heading");
    const sectionName = heading?.textContent || "";

    const rect = range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    selectedTextRef.current = text;
    setSelectionPopup({
      x: rect.left - containerRect.left + rect.width / 2,
      y: rect.top - containerRect.top - 8,
      section: sectionName,
    });
  }, [hasActions]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if ((e.target as HTMLElement).closest(".selection-popup")) return;
      setSelectionPopup(null);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const actions: SelectionAction[] = selectionActions
    ? selectionActions
    : selectionAction && onTextSelect
      ? [{ label: selectionAction, onSelect: onTextSelect }]
      : [];

  return (
    <div
      ref={mergedRef}
      className="page-detail-content"
      style={{ position: "relative" }}
      onMouseUp={handleMouseUp}
    >
      {children}
      {selectionPopup && actions.length > 0 && (
        <div
          className="selection-popup"
          style={{
            position: "absolute",
            left: selectionPopup.x,
            top: selectionPopup.y,
            transform: "translate(-50%, -100%)",
          }}
        >
          <span className="selection-popup-inner">
            {actions.map((action) => (
              <button
                key={action.label}
                className="selection-popup-btn"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  action.onSelect(selectionPopup.section, selectedTextRef.current);
                  setSelectionPopup(null);
                }}
              >
                {action.label}
              </button>
            ))}
          </span>
        </div>
      )}
    </div>
  );
});
