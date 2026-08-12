"use client";

import { useMemo, useState } from "react";

/**
 * Dropdown multi-select over the org's known tags plus type-to-create.
 * Used by the dashboard's untagged queue and the page detail tag row.
 */
export function TagPicker({
  options,
  onSave,
  label = "add tags",
}: {
  options: string[];
  onSave: (tags: string[]) => Promise<boolean>;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [created, setCreated] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const all = useMemo(() => [...new Set([...options, ...created])], [options, created]);

  const toggle = (tag: string) =>
    setSelected((s) => (s.includes(tag) ? s.filter((t) => t !== tag) : [...s, tag]));

  const addDraft = () => {
    const t = draft.trim().toLowerCase();
    if (!t) return;
    if (!all.includes(t)) setCreated((c) => [...c, t]);
    if (!selected.includes(t)) setSelected((s) => [...s, t]);
    setDraft("");
  };

  const save = async () => {
    if (selected.length === 0 || busy) return;
    setBusy(true);
    const ok = await onSave(selected);
    setBusy(false);
    if (ok) {
      setOpen(false);
      setSelected([]);
      setCreated([]);
    }
  };

  return (
    <span className="kg-picker">
      <button type="button" className="kg-picker-btn" onClick={() => setOpen(!open)}>
        {label} <span aria-hidden>▾</span>
      </button>
      {open && (
        <>
          <span className="kg-picker-backdrop" onClick={() => setOpen(false)} />
          <span className="kg-picker-menu">
            <span className="kg-picker-list">
              {all.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={
                    selected.includes(t) ? "kg-picker-item kg-picker-item-on" : "kg-picker-item"
                  }
                  onClick={() => toggle(t)}
                >
                  <span className="kg-picker-check">{selected.includes(t) ? "✓" : ""}</span>
                  {t}
                </button>
              ))}
            </span>
            <span className="kg-picker-foot">
              <input
                className="kg-tag-input"
                placeholder="new tag…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addDraft();
                  }
                }}
              />
              <button
                type="button"
                className="kg-tag-save"
                disabled={busy || selected.length === 0}
                onClick={save}
              >
                {busy ? "…" : `save${selected.length ? ` (${selected.length})` : ""}`}
              </button>
            </span>
          </span>
        </>
      )}
    </span>
  );
}
