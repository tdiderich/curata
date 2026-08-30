"use client";

import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "./toast";

export interface SelectionAction {
  label: string;
  onSelect: (section: string, selectedText: string, componentId: string) => void;
}

export interface ReorderEvent {
  componentId: string;
  targetId: string;
  position: "before" | "after";
}

export const PageContent = forwardRef<
  HTMLDivElement,
  {
    children?: React.ReactNode;
    selectionAction?: string;
    selectionActions?: SelectionAction[];
    onTextSelect?: (section: string, selectedText: string) => void;
    editMode?: boolean;
    onReorder?: (event: ReorderEvent) => void;
  }
>(function PageContent({ children, selectionAction, selectionActions, onTextSelect, editMode, onReorder }, forwardedRef) {
  const localRef = useRef<HTMLDivElement>(null);
  const selectedTextRef = useRef("");
  const [selectionPopup, setSelectionPopup] = useState<{
    x: number;
    y: number;
    section: string;
    componentId: string;
  } | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: "before" | "after" } | null>(null);
  const dropTargetRef = useRef(dropTarget);

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
    const sel = window.getSelection();
    const container = localRef.current;
    if (!sel || sel.isCollapsed || !container) return;

    const text = sel.toString().trim();
    if (!text) return;

    navigator.clipboard.writeText(text).then(() => toast.success("Copied to clipboard")).catch(() => {});

    if (!hasActions) return;

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

    let compNode: Node | null = range.startContainer;
    let componentId = "";
    while (compNode && compNode !== container) {
      if (compNode instanceof HTMLElement && compNode.id) {
        for (const cls of compNode.classList) {
          if (cls.startsWith("c-") && !cls.includes("-scale")) {
            componentId = compNode.id;
            break;
          }
        }
        if (componentId) break;
      }
      compNode = compNode.parentNode;
    }
    if (!componentId) {
      const startEl = range.startContainer instanceof HTMLElement
        ? range.startContainer
        : range.startContainer.parentElement;
      const wrapper = startEl?.closest<HTMLElement>("[data-component-id]");
      if (wrapper) componentId = wrapper.dataset.componentId!;
    }

    const rect = range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    selectedTextRef.current = text;
    setSelectionPopup({
      x: rect.left - containerRect.left + rect.width / 2,
      y: rect.top - containerRect.top - 8,
      section: sectionName,
      componentId,
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

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    const el = document.getElementById(hash);
    if (el) {
      requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }, []);

  useEffect(() => {
    const container = localRef.current;
    if (!container) return;
    function handleAnchorClick(e: MouseEvent) {
      const btn = (e.target as HTMLElement).closest(".section-anchor");
      if (!btn || !container?.contains(btn)) return;
      const section = btn.closest(".c-section");
      if (!section || !section.id) return;
      const url = `${window.location.origin}${window.location.pathname}#${section.id}`;
      navigator.clipboard.writeText(url).catch(() => {});
      btn.classList.add("section-anchor--copied");
      setTimeout(() => btn.classList.remove("section-anchor--copied"), 1200);
    }
    container.addEventListener("click", handleAnchorClick);
    return () => container.removeEventListener("click", handleAnchorClick);
  }, []);

  const actions: SelectionAction[] = selectionActions
    ? selectionActions
    : selectionAction && onTextSelect
      ? [{ label: selectionAction, onSelect: onTextSelect }]
      : [];

  useEffect(() => {
    const container = localRef.current;
    if (!container) return;

    const headings = container.querySelectorAll(".c-section-heading");
    headings.forEach((h) => {
      if (h.querySelector(".section-anchor")) return;
      const btn = document.createElement("button");
      btn.className = "section-anchor";
      btn.setAttribute("aria-label", "Copy link to section");
      btn.textContent = "#";
      h.appendChild(btn);
    });

  });

  useEffect(() => {
    if (!editMode || !onReorder) return;
    const container = localRef.current;
    if (!container) return;

    function handleDragStart(e: DragEvent) {
      const wrapper = (e.target as HTMLElement).closest<HTMLElement>(".editable-component[data-component-id]");
      if (wrapper) {
        dragIdRef.current = wrapper.dataset.componentId!;
        wrapper.classList.add("dragging");
      }
    }

    function handleDragEnd() {
      if (dragIdRef.current) {
        const el = container!.querySelector(`[data-component-id="${dragIdRef.current}"]`);
        el?.classList.remove("dragging");
      }
      dragIdRef.current = null;
      setDropTarget(null);
    }

    function handleDragOver(e: DragEvent) {
      if (!dragIdRef.current) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = "move";

      const wrappers = Array.from(container!.querySelectorAll<HTMLElement>(".editable-component[data-component-id]"));

      let closest: HTMLElement | null = null;
      let closestDist = Infinity;
      let pos: "before" | "after" = "before";

      for (const w of wrappers) {
        const wId = w.dataset.componentId!;
        if (wId === dragIdRef.current) continue;
        const rect = w.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const dist = Math.abs(e.clientY - midY);
        if (dist < closestDist) {
          closestDist = dist;
          closest = w;
          pos = e.clientY < midY ? "before" : "after";
        }
      }

      if (closest) {
        setDropTarget({ id: closest.dataset.componentId!, position: pos });
      }
    }

    function handleDrop(e: DragEvent) {
      e.preventDefault();
      const srcId = dragIdRef.current;
      if (!srcId || !dropTargetRef.current) return;
      const { id: targetId, position } = dropTargetRef.current;

      // React re-renders the new order from state; moving DOM nodes by hand
      // here fought that reconciliation and left components out of place.
      onReorder!({ componentId: srcId, targetId, position });
      dragIdRef.current = null;
      setDropTarget(null);
    }

    function handleDragLeave(e: DragEvent) {
      if (!container!.contains(e.relatedTarget as Node)) {
        setDropTarget(null);
      }
    }

    container.addEventListener("dragstart", handleDragStart);
    container.addEventListener("dragend", handleDragEnd);
    container.addEventListener("dragover", handleDragOver);
    container.addEventListener("drop", handleDrop);
    container.addEventListener("dragleave", handleDragLeave);
    return () => {
      container.removeEventListener("dragstart", handleDragStart);
      container.removeEventListener("dragend", handleDragEnd);
      container.removeEventListener("dragover", handleDragOver);
      container.removeEventListener("drop", handleDrop);
      container.removeEventListener("dragleave", handleDragLeave);
    };
  }, [editMode, onReorder]);

  dropTargetRef.current = dropTarget;

  useEffect(() => {
    if (!editMode) return;
    const container = localRef.current;
    if (!container) return;
    container.querySelectorAll(".drop-indicator").forEach((el) => el.remove());
    if (!dropTarget) return;

    const targetEl = container.querySelector<HTMLElement>(`[data-component-id="${dropTarget.id}"]`);
    if (!targetEl) return;

    const indicator = document.createElement("div");
    indicator.className = "drop-indicator";

    if (dropTarget.position === "before") {
      targetEl.parentNode!.insertBefore(indicator, targetEl);
    } else {
      targetEl.parentNode!.insertBefore(indicator, targetEl.nextSibling);
    }
  }, [editMode, dropTarget]);

  return (
    <div
      ref={mergedRef}
      className="page-detail-content"
      style={{ position: "relative" }}
      onMouseUp={handleMouseUp}
      {...(editMode ? { "data-edit-mode": "" } : {})}
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
                  action.onSelect(selectionPopup.section, selectedTextRef.current, selectionPopup.componentId);
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
