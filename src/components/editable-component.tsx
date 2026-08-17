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
}: EditableComponentProps) {
  const id = (comp.id as string) || `c-${index}`;
  const compType = comp.type;
  const isEditing = editingId === id;
  const elRef = useRef<HTMLDivElement>(null);

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
      onDragStart?.(id);
    },
    [id, onDragStart],
  );

  const handleDragEnd = useCallback(() => {
    onDragEnd?.();
  }, [onDragEnd]);

  return (
    <div
      ref={elRef}
      className={`editable-component${isEditing ? " component-editing" : ""}`}
      data-component-type={compType}
      data-component-id={id}
    >
      {children}
      <div className="component-chrome">
        {onEdit && (
          <button
            className="component-edit"
            aria-label="Edit component"
            onClick={() => onEdit(id, compType)}
          >
            Edit
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
