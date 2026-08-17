"use client";

import { useCallback, useMemo, useState } from "react";
import { PALETTE, type PaletteEntry } from "@/lib/component-palette";
import yaml from "js-yaml";

interface AddComponentButtonProps {
  onAdd: (component: Record<string, unknown>) => void;
  disabled?: boolean;
}

const GROUPS = ["Text", "Data", "Structure", "Layout", "Sequence", "Interactive", "Meta"];

export function AddComponentButton({ onAdd, disabled }: AddComponentButtonProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    if (!filter) return PALETTE;
    const q = filter.toLowerCase();
    return PALETTE.filter(
      (e) => e.label.toLowerCase().includes(q) || e.type.toLowerCase().includes(q) || e.description.toLowerCase().includes(q),
    );
  }, [filter]);

  const grouped = useMemo(() => {
    const map = new Map<string, PaletteEntry[]>();
    for (const g of GROUPS) map.set(g, []);
    for (const e of filtered) {
      const arr = map.get(e.group);
      if (arr) arr.push(e);
    }
    return [...map.entries()].filter(([, entries]) => entries.length > 0);
  }, [filtered]);

  const handleSelect = useCallback(
    (entry: PaletteEntry) => {
      const stub = entry.stub.replace(/^- /, "");
      const parsed = yaml.load(stub) as Record<string, unknown>;
      onAdd(parsed);
      setOpen(false);
      setFilter("");
    },
    [onAdd],
  );

  return (
    <>
      <button
        className="add-component-btn"
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-label="Add component"
      >
        + Add Component
      </button>

      {open && (
        <div className="add-component-overlay" onClick={() => { setOpen(false); setFilter(""); }}>
          <div className="add-component-modal" onClick={(e) => e.stopPropagation()}>
            <div className="add-component-header">
              <input
                className="add-component-search"
                type="text"
                placeholder="Search components..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                autoFocus
              />
              <button className="add-component-close" onClick={() => { setOpen(false); setFilter(""); }}>
                &times;
              </button>
            </div>
            <div className="add-component-list">
              {grouped.map(([group, entries]) => (
                <div key={group} className="add-component-group">
                  <div className="add-component-group-label">{group}</div>
                  {entries.map((entry) => (
                    <button
                      key={entry.type}
                      className="add-component-item"
                      onClick={() => handleSelect(entry)}
                    >
                      <span className="add-component-item-label">{entry.label}</span>
                      <span className="add-component-item-desc">{entry.description}</span>
                    </button>
                  ))}
                </div>
              ))}
              {grouped.length === 0 && (
                <div className="add-component-empty">No matching components</div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
