"use client";

import { useEffect, useMemo, useState } from "react";
import { CONCEPT_KINDS, DEFAULT_KIND, kindSlug, type ConceptKind } from "@/lib/concept-kinds";

export interface TagOption {
  term: string;
  kind: string;
}

/** Client-side mirror of normalizeTerm: terms are lowercase slugs. */
function slugifyTerm(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Dropdown multi-select over the org's known tags plus type-to-create.
 * Existing options show their kind; the kind row applies only to tags created
 * in this save (picking an existing tag never silently re-kinds it).
 * Used by the dashboard's untagged queue and the page detail tag row.
 */
export function TagPicker({
  options,
  onSave,
  label = "add tags",
  hideTrigger,
  openOnEvent,
}: {
  options: TagOption[];
  onSave: (tags: TagOption[]) => Promise<boolean>;
  label?: string;
  /** Hide the trigger button (the picker then opens only via openOnEvent). */
  hideTrigger?: boolean;
  /** Window event name that opens this picker, for command-palette actions. */
  openOnEvent?: string;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [created, setCreated] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [newKind, setNewKind] = useState<ConceptKind>(DEFAULT_KIND);
  const [busy, setBusy] = useState(false);

  const kindByTerm = useMemo(() => {
    const map = new Map(options.map((o) => [o.term, o.kind]));
    for (const t of created) map.set(t, newKind);
    return map;
  }, [options, created, newKind]);

  const all = useMemo(
    () => [...new Set([...options.map((o) => o.term), ...created])],
    [options, created]
  );

  useEffect(() => {
    if (!openOnEvent) return;
    const openIt = () => setOpen(true);
    window.addEventListener(openOnEvent, openIt);
    return () => window.removeEventListener(openOnEvent, openIt);
  }, [openOnEvent]);

  const toggle = (tag: string) =>
    setSelected((s) => (s.includes(tag) ? s.filter((t) => t !== tag) : [...s, tag]));

  const addDraft = () => {
    const t = slugifyTerm(draft);
    if (!t) return;
    if (!all.includes(t)) setCreated((c) => [...c, t]);
    if (!selected.includes(t)) setSelected((s) => [...s, t]);
    setDraft("");
  };

  const save = async () => {
    if (selected.length === 0 || busy) return;
    setBusy(true);
    const ok = await onSave(
      selected.map((term) => ({
        term,
        kind: created.includes(term) ? newKind : kindByTerm.get(term) || DEFAULT_KIND,
      }))
    );
    setBusy(false);
    if (ok) {
      setOpen(false);
      setSelected([]);
      setCreated([]);
      setNewKind(DEFAULT_KIND);
    }
  };

  return (
    <span className="kg-picker">
      {!hideTrigger && (
        <button type="button" className="kg-picker-btn" onClick={() => setOpen(!open)}>
          {label} <span aria-hidden>▾</span>
        </button>
      )}
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
                  <span
                    className={`pg-tag-kind-dot pg-dot-${kindSlug(kindByTerm.get(t))}`}
                    aria-hidden
                  />
                  {t}
                  <span className="kg-picker-kind">{kindSlug(kindByTerm.get(t))}</span>
                </button>
              ))}
            </span>
            {created.length > 0 && (
              <span className="kg-picker-kindrow">
                <span className="kg-picker-kindrow-label">kind for new tags</span>
                <span className="kg-picker-kinds">
                  {CONCEPT_KINDS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      className={newKind === k ? "kg-kind-seg kg-kind-seg-on" : "kg-kind-seg"}
                      onClick={() => setNewKind(k)}
                    >
                      <span className={`pg-tag-kind-dot pg-dot-${k}`} aria-hidden />
                      {k}
                    </button>
                  ))}
                </span>
              </span>
            )}
            <span className="kg-picker-foot">
              <input
                className="kg-tag-input"
                placeholder="new-tag…"
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
