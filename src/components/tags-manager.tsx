"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { basePath } from "@/lib/api-fetch";
import { SettingsSection } from "@/components/settings/settings-section";
import { SettingsTable } from "@/components/settings/settings-table";
import { StatusBadge, type StatusBadgeTone } from "@/components/settings/status-badge";
import { FormRow } from "@/components/settings/form-row";
import { SegmentedControl } from "@/components/settings/segmented-control";
import { CONCEPT_KINDS, DEFAULT_KIND, isCuratedKind, type ConceptKind } from "@/lib/concept-kinds";

interface TagRow {
  id: string;
  term: string;
  kind: string;
  pageCount: number;
}

/** Sentinel editingId meaning "drafting a brand-new tag, not yet saved". */
const NEW_TAG = "__new__";

function kindTone(kind: string): StatusBadgeTone {
  return isCuratedKind(kind) ? kind : DEFAULT_KIND;
}

/**
 * Tags settings tab: every concept used by this org's pages, with term and
 * kind both editable. Rename re-points every tagged page (Concept rows are
 * shared globally, not org-scoped — see the route's cross-org comment).
 * Removing detaches the tag from this org's pages rather than deleting the
 * shared Concept row (kept in case another org or a future re-tag uses it).
 */
export function TagsManager({ canManage }: { canManage: boolean }) {
  const router = useRouter();
  const [tags, setTags] = useState<TagRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [formTerm, setFormTerm] = useState("");
  const [formKind, setFormKind] = useState<ConceptKind>(DEFAULT_KIND);

  const [merging, setMerging] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${basePath}/api/tags/org`);
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Failed to load tags");
        return;
      }
      const data = (await res.json()) as { concepts: TagRow[] };
      setTags(data.concepts);
    } catch {
      setError("Failed to load tags");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  function startEdit(tag: TagRow) {
    setEditingId(tag.id);
    setFormTerm(tag.term);
    setFormKind(isCuratedKind(tag.kind) ? tag.kind : DEFAULT_KIND);
    setMerging(false);
    setMergeTargetId(null);
    setNote(null);
    setError(null);
  }

  function startNewTag() {
    setEditingId(NEW_TAG);
    setFormTerm("");
    setFormKind(DEFAULT_KIND);
    setMerging(false);
    setMergeTargetId(null);
    setNote(null);
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setFormTerm("");
    setFormKind(DEFAULT_KIND);
    setMerging(false);
    setMergeTargetId(null);
  }

  function startMerge() {
    setMerging(true);
    setMergeTargetId(null);
    setError(null);
  }

  function cancelMerge() {
    setMerging(false);
    setMergeTargetId(null);
  }

  async function confirmMerge() {
    if (!editingId || editingId === NEW_TAG || !mergeTargetId) return;
    const source = tags.find((t) => t.id === editingId);
    const target = tags.find((t) => t.id === mergeTargetId);
    if (!source || !target) return;
    if (!confirm(`Merge "${source.term}" into "${target.term}"? Every page tagged "${source.term}" will be retagged, and "${source.term}" will be deleted.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${basePath}/api/tags/org`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceConceptId: editingId, targetConceptId: mergeTargetId }),
      });
      const data = (await res.json()) as { error?: string; concept?: TagRow };
      if (!res.ok || !data.concept) {
        setError(data.error ?? "Failed to merge tag.");
        return;
      }
      setTags((prev) => prev.filter((t) => t.id !== editingId).map((t) => (t.id === mergeTargetId ? data.concept! : t)));
      cancelEdit();
      setNote(`Merged "${source.term}" into "${target.term}".`);
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const term = formTerm.trim();
    if (!editingId || !term) return;
    setBusy(true);
    setError(null);
    try {
      if (editingId === NEW_TAG) {
        const res = await fetch(`${basePath}/api/tags/org`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ term, kind: formKind }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          setError(data.error ?? "Failed to create tag.");
          return;
        }
        cancelEdit();
        setNote("Created. Tag a page with it to see it listed here.");
      } else {
        const res = await fetch(`${basePath}/api/tags/org`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conceptId: editingId, term, kind: formKind }),
        });
        const data = (await res.json()) as { error?: string; concept?: TagRow };
        if (!res.ok || !data.concept) {
          setError(data.error ?? "Failed to update tag.");
          return;
        }
        setTags((prev) => prev.map((t) => (t.id === editingId ? data.concept! : t)));
        cancelEdit();
      }
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function removeTag(tag: TagRow) {
    if (!confirm(`Remove "${tag.term}" from every page in this org? The tag definition itself is kept.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${basePath}/api/tags/org?conceptId=${tag.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Failed to remove tag.");
        return;
      }
      setTags((prev) => prev.filter((t) => t.id !== tag.id));
      if (editingId === tag.id) cancelEdit();
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="members-loading">Loading tags&hellip;</div>;
  }

  return (
    <SettingsSection
      title="Tags"
      description="Every concept used by this org's pages. Term and kind are both editable; kind drives color in the knowledge graph."
    >
      {error && <div className="members-error">{error}</div>}
      {note && <div className="cr-field-hint">{note}</div>}

      <SettingsTable
        head={
          <>
            <th className="dash-th dash-th-title" style={{ width: "34%" }}>Term</th>
            <th className="dash-th">Kind</th>
            <th className="dash-th">Pages</th>
            {canManage && <th className="dash-th stg-th-right">&nbsp;</th>}
          </>
        }
        empty={tags.length === 0 ? "No tags used by this organization's pages yet." : undefined}
      >
        {tags.map((tag) => {
          const isEditing = editingId === tag.id;
          return (
            <tr key={tag.id} className="dash-row">
              <td className="dash-td dash-td-title">
                <span className="pill pill--mono pill--chip" style={{ padding: "1px 9px" }}>{tag.term}</span>
              </td>
              <td className="dash-td">
                <StatusBadge tone={kindTone(tag.kind)} label={tag.kind || DEFAULT_KIND} />
              </td>
              <td className="dash-td">
                <span className="stg-pcount">{tag.pageCount}</span>
              </td>
              {canManage && (
                <td className="dash-td stg-td-right">
                  {isEditing ? (
                    <span className="stg-row-actions stg-row-actions--pinned">
                      <span className="stg-qbtn" style={{ opacity: 0.6, cursor: "default" }}>Editing&hellip;</span>
                    </span>
                  ) : (
                    <span className="stg-row-actions">
                      <button className="stg-qbtn" onClick={() => startEdit(tag)} disabled={busy}>Edit</button>
                      <button className="stg-qbtn stg-qbtn--danger" onClick={() => removeTag(tag)} disabled={busy}>Remove</button>
                    </span>
                  )}
                </td>
              )}
            </tr>
          );
        })}
      </SettingsTable>

      {editingId && (
        <div className="stg-editor">
          <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <FormRow label="Term" hint="Lowercase, hyphenated. Renaming re-points every tagged page.">
                <input className="stg-input" value={formTerm} onChange={(e) => setFormTerm(e.target.value)} autoFocus />
              </FormRow>
            </div>
            <FormRow label="Kind">
              <SegmentedControl<ConceptKind>
                value={formKind}
                onChange={setFormKind}
                options={CONCEPT_KINDS.map((k) => ({ value: k, label: k }))}
              />
            </FormRow>
          </div>
          {editingId !== NEW_TAG && merging && (
            <div className="stg-editor-foot" style={{ marginTop: 8 }}>
              <select
                className="stg-input"
                value={mergeTargetId ?? ""}
                onChange={(e) => setMergeTargetId(e.target.value || null)}
                disabled={busy}
              >
                <option value="">Select a tag to merge into&hellip;</option>
                {tags
                  .filter((t) => t.id !== editingId)
                  .map((t) => (
                    <option key={t.id} value={t.id}>{t.term}</option>
                  ))}
              </select>
              <button className="btn btn--primary" onClick={confirmMerge} disabled={busy || !mergeTargetId}>
                {busy ? "Merging…" : "Confirm merge"}
              </button>
              <button className="btn btn--ghost" onClick={cancelMerge} disabled={busy}>Cancel merge</button>
            </div>
          )}
          <div className="stg-editor-foot">
            <button className="btn btn--primary" onClick={save} disabled={busy || !formTerm.trim() || merging}>
              {busy ? "Saving…" : "Save tag"}
            </button>
            <button className="btn btn--ghost" onClick={cancelEdit} disabled={busy}>Cancel</button>
            <span className="stg-editor-foot-spacer" />
            {editingId !== NEW_TAG && !merging && (
              <button className="stg-qbtn" onClick={startMerge} disabled={busy}>
                Merge into&hellip;
              </button>
            )}
          </div>
        </div>
      )}

      {canManage && !editingId && (
        <div className="stg-composer">
          <button className="btn btn--ghost" onClick={startNewTag} disabled={busy}>
            + Add tag
          </button>
        </div>
      )}
    </SettingsSection>
  );
}
