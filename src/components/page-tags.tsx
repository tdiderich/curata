"use client";

import { useState } from "react";
import { TagPicker } from "./tag-picker";
import { basePath } from "@/lib/api-fetch";
import { CONCEPT_KINDS, kindSlug } from "@/lib/concept-kinds";

export interface PageTag {
  term: string;
  kind: string;
}

/**
 * The page's tag row: current tags as kind-tinted chips (click ✕ to untag,
 * click the kind dot to re-kind) plus the shared picker to add more. Tags are
 * what place a page in the knowledge graph and the agents' brain map.
 */
export function PageTags({
  pageId,
  initialTags,
  tagOptions,
  canEdit,
  pickerViaPalette,
  maxVisible,
  folderTag,
}: {
  pageId: string;
  initialTags: PageTag[];
  tagOptions: PageTag[];
  canEdit: boolean;
  /** Hide the add-tags trigger; the picker opens from the command palette. */
  pickerViaPalette?: boolean;
  /** Show at most this many chips, collapsing the rest behind a +N toggle. */
  maxVisible?: number;
  /** Folder-derived tag: shown as a structural chip, removable only by moving the page. */
  folderTag?: string;
}) {
  const [tags, setTags] = useState(initialTags);
  const [showAll, setShowAll] = useState(false);
  const [kindEditor, setKindEditor] = useState<string | null>(null);

  const add = async (newTags: PageTag[]) => {
    const res = await fetch(`${basePath}/api/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageId, tags: newTags }),
    }).catch(() => null);
    if (res?.ok) {
      setTags((t) => {
        const next = new Map(t.map((x) => [x.term, x]));
        for (const nt of newTags) next.set(nt.term, nt);
        return [...next.values()];
      });
      return true;
    }
    return false;
  };

  const remove = async (term: string) => {
    const prev = tags;
    setTags((t) => t.filter((x) => x.term !== term));
    const res = await fetch(`${basePath}/api/tags`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageId, tag: term }),
    }).catch(() => null);
    if (!res?.ok) setTags(prev);
  };

  // Kind lives on the concept, so this re-kinds the tag everywhere it's used.
  const setKind = async (term: string, kind: string) => {
    setKindEditor(null);
    const prev = tags;
    setTags((t) => t.map((x) => (x.term === term ? { ...x, kind } : x)));
    const res = await fetch(`${basePath}/api/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageId, tags: [{ term, kind }] }),
    }).catch(() => null);
    if (!res?.ok) setTags(prev);
  };

  if (!canEdit && tags.length === 0) return null;

  const visible = maxVisible && !showAll ? tags.slice(0, maxVisible) : tags;
  const hidden = tags.length - visible.length;
  const tagTerms = new Set(tags.map((t) => t.term));

  return (
    <div className="pg-tags">
      {folderTag && !tagTerms.has(folderTag) && (
        <span className="pg-tag pg-tag-folder" title={`from folder "${folderTag}" - move the page to change it`}>
          {folderTag}
        </span>
      )}
      {visible.map((t) => (
        <span key={t.term} className={`pg-tag pg-tag-k-${kindSlug(t.kind)}`}>
          {canEdit ? (
            <button
              type="button"
              className="pg-tag-kind-dot"
              aria-label={`change kind of ${t.term} (now ${kindSlug(t.kind)}, applies everywhere this tag is used)`}
              title={`${kindSlug(t.kind)} - click to change (applies everywhere)`}
              onClick={() => setKindEditor(kindEditor === t.term ? null : t.term)}
            />
          ) : (
            <span className="pg-tag-kind-dot" aria-hidden />
          )}
          {t.term}
          {canEdit && (
            <button
              type="button"
              className="pg-tag-x"
              aria-label={`remove tag ${t.term}`}
              onClick={() => remove(t.term)}
            >
              ✕
            </button>
          )}
          {kindEditor === t.term && (
            <span className="pg-kind-pop">
              {CONCEPT_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`pg-kind-opt${kindSlug(t.kind) === k ? " pg-kind-opt-on" : ""}`}
                  onClick={() => setKind(t.term, k)}
                >
                  <span className={`pg-tag-kind-dot pg-dot-${k}`} aria-hidden />
                  {k}
                </button>
              ))}
            </span>
          )}
        </span>
      ))}
      {hidden > 0 && (
        <button type="button" className="pg-tag pg-tag-more" onClick={() => setShowAll(true)}>
          +{hidden}
        </button>
      )}
      {maxVisible && showAll && tags.length > maxVisible && (
        <button type="button" className="pg-tag pg-tag-more" onClick={() => setShowAll(false)}>
          show less
        </button>
      )}
      {canEdit && (
        <TagPicker
          options={tagOptions.filter((o) => !tagTerms.has(o.term))}
          onSave={add}
          hideTrigger={pickerViaPalette}
          openOnEvent={pickerViaPalette ? "curata-open-tags" : undefined}
        />
      )}
    </div>
  );
}
