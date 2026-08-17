"use client";

import { useEffect, useMemo, useState } from "react";
import { CONCEPT_KINDS, DEFAULT_KIND, kindSlug, type ConceptKind } from "@/lib/concept-kinds";
import { SegmentedControl } from "@/components/settings/segmented-control";

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

  // Live slug of whatever is in the input — shown as a "create" row and
  // folded into save automatically, no Enter required.
  const draftSlug = slugifyTerm(draft);
  const draftIsNew = !!draftSlug && !all.includes(draftSlug);

  const addDraft = () => {
    if (!draftSlug) return;
    if (!all.includes(draftSlug)) setCreated((c) => [...c, draftSlug]);
    if (!selected.includes(draftSlug)) setSelected((s) => [...s, draftSlug]);
    setDraft("");
  };

  const pendingCount = selected.length + (draftSlug && !selected.includes(draftSlug) ? 1 : 0);

  const save = async () => {
    if (pendingCount === 0 || busy) return;
    // Fold an un-committed draft into the save so typing + save just works.
    const terms = [...selected];
    const extraCreated = [...created];
    if (draftSlug && !terms.includes(draftSlug)) {
      terms.push(draftSlug);
      if (!all.includes(draftSlug)) extraCreated.push(draftSlug);
    }
    setBusy(true);
    const ok = await onSave(
      terms.map((term) => ({
        term,
        kind: extraCreated.includes(term) ? newKind : kindByTerm.get(term) || DEFAULT_KIND,
      }))
    );
    setBusy(false);
    if (ok) {
      setOpen(false);
      setSelected([]);
      setCreated([]);
      setDraft("");
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
              {draftIsNew && (
                <button type="button" className="kg-picker-item kg-picker-create" onClick={addDraft}>
                  <span className="kg-picker-check">+</span>
                  <span className={`pg-tag-kind-dot pg-dot-${newKind}`} aria-hidden />
                  create &ldquo;{draftSlug}&rdquo;
                </button>
              )}
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
            {(created.length > 0 || draftIsNew) && (
              <span className="kg-picker-kindrow">
                <span className="kg-picker-kindrow-label">kind for new tags</span>
                <SegmentedControl<ConceptKind>
                  value={newKind}
                  onChange={setNewKind}
                  options={CONCEPT_KINDS.map((k) => ({
                    value: k,
                    label: k,
                    icon: <span className={`pg-tag-kind-dot pg-dot-${k}`} aria-hidden />,
                  }))}
                />
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
                disabled={busy || pendingCount === 0}
                onClick={save}
              >
                {busy ? "…" : pendingCount > 1 ? `save ${pendingCount}` : "save"}
              </button>
            </span>
          </span>
        </>
      )}
    </span>
  );
}
