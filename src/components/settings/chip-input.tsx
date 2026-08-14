"use client";

import { useState } from "react";

export interface ChipInputOption {
  id: string;
  label: string;
  sublabel?: string;
}

export interface ChipInputChip {
  id: string;
  label: string;
}

/**
 * Generic multi-select chip editor: existing chips with a remove button,
 * plus a typeahead input over a caller-supplied option list. Used by the
 * approval-rule approvers editor (groups + members); org tags keep the
 * TagPicker's create-and-kind flow since that's a materially different
 * interaction (freeform create + kind selection, not a picklist).
 */
export function ChipInput({
  chips,
  onRemove,
  options,
  onAdd,
  placeholder = "Add…",
  disabled,
}: {
  chips: ChipInputChip[];
  onRemove: (id: string) => void;
  options: ChipInputOption[];
  onAdd: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const selectedIds = new Set(chips.map((c) => c.id));
  const filtered = options
    .filter((o) => !selectedIds.has(o.id))
    .filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 20);

  function pick(id: string) {
    onAdd(id);
    setQuery("");
    setOpen(false);
  }

  return (
    <div className="stg-chip-row">
      {chips.map((c) => (
        <span key={c.id} className="stg-chip">
          {c.label}
          {!disabled && (
            <button
              type="button"
              className="stg-chip-x"
              onClick={() => onRemove(c.id)}
              aria-label={`remove ${c.label}`}
            >
              &times;
            </button>
          )}
        </span>
      ))}
      {!disabled && (
        <div className="stg-chip-input-wrap">
          <input
            className="stg-chip-input"
            value={query}
            placeholder={placeholder}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
          />
          {open && (
            <div className="stg-picker-pop">
              {filtered.length === 0 ? (
                <div className="stg-picker-empty">No matches.</div>
              ) : (
                filtered.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    className="stg-picker-opt"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(o.id)}
                  >
                    {o.label}
                    {o.sublabel && <span className="stg-picker-opt-tag">{o.sublabel}</span>}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
