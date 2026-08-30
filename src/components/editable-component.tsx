"use client";

import React, { useRef, useCallback } from "react";
import type { ComponentData } from "@/generated/kazam-renderer";

interface EditableComponentProps {
  comp: ComponentData;
  index: number;
  children: React.ReactNode;
  onEdit?: (componentId: string, componentType: string) => void;
  onDelete?: (componentId: string) => void;
  onDragStart?: (id: string) => void;
  onDragEnd?: () => void;
  editingId?: string | null;
  /** id of the component currently being dragged, if any; all components collapse to summary rows while set */
  draggingId?: string | null;
}

function compLabel(comp: ComponentData): string {
  return (comp.heading as string) || (comp.title as string) || (comp.eyebrow as string) || (comp.label as string) || (comp.type as string) || "";
}

export function EditableComponent({
  comp,
  index,
  children,
  onEdit,
  onDelete,
  onDragStart,
  onDragEnd,
  editingId,
  draggingId,
}: EditableComponentProps) {
  const id = (comp.id as string) || `c-${index}`;
  const compType = comp.type;
  const mirrorSlug = compType === "section" && typeof comp.slug === "string" ? (comp.slug as string) : null;
  const isEditing = editingId === id;
  const elRef = useRef<HTMLDivElement>(null);
  const collapsed = draggingId !== null && draggingId !== undefined;
  const dragging = draggingId === id;

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
      requestAnimationFrame(() => onDragStart?.(id));
    },
    [id, onDragStart],
  );

  const handleDragEnd = useCallback(() => {
    onDragEnd?.();
  }, [onDragEnd]);

  return (
    <div
      ref={elRef}
      className={`editable-component${isEditing ? " component-editing" : ""}${collapsed ? " drag-collapsed" : ""}${dragging ? " component-dragging" : ""}`}
      data-component-type={compType}
      data-component-id={id}
    >
      {collapsed ? (
        <div className="drag-collapsed-summary">
          <span className="drag-collapsed-type">{compType}</span>
          <span className="drag-collapsed-label">{compLabel(comp)}</span>
        </div>
      ) : (
        children
      )}
      {!collapsed && (
        <div className="component-chrome">
          {mirrorSlug && (
            <span className="component-mirror-badge">&#x1f517; mirrored from {mirrorSlug}</span>
          )}
          {onEdit && (
            <button
              className="component-edit"
              aria-label="Component details"
              title="Fields, YAML, and focused editing"
              onClick={() => onEdit(id, compType)}
            >
              Details
            </button>
          )}
          {onDelete && (
            <button
              className="component-delete"
              aria-label="Delete component"
              onClick={() => {
                if (confirm("Delete this component?")) onDelete(id);
              }}
            >
              &times;
            </button>
          )}
        </div>
      )}
      {onDragStart && (
        <button
          className="drag-handle"
          aria-label="Drag to reorder"
          draggable
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          &#9776;
        </button>
      )}
    </div>
  );
}
