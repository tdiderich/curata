"use client";

import { useState } from "react";
import { TagPicker } from "./tag-picker";

/**
 * The page's tag row: current tags as chips (click ✕ to untag) plus the
 * shared picker to add more. Tags are what place a page in the knowledge
 * graph and the agents' brain map.
 */
export function PageTags({
  pageId,
  initialTags,
  tagOptions,
  canEdit,
}: {
  pageId: string;
  initialTags: string[];
  tagOptions: string[];
  canEdit: boolean;
}) {
  const [tags, setTags] = useState(initialTags);

  const add = async (newTags: string[]) => {
    const res = await fetch("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageId, tags: newTags }),
    }).catch(() => null);
    if (res?.ok) {
      setTags((t) => [...new Set([...t, ...newTags.map((x) => x.toLowerCase())])]);
      return true;
    }
    return false;
  };

  const remove = async (tag: string) => {
    setTags((t) => t.filter((x) => x !== tag));
    const res = await fetch("/api/tags", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageId, tag }),
    }).catch(() => null);
    if (!res?.ok) setTags((t) => (t.includes(tag) ? t : [...t, tag]));
  };

  if (!canEdit && tags.length === 0) return null;

  return (
    <div className="pg-tags">
      {tags.map((t) => (
        <span key={t} className="pg-tag">
          {t}
          {canEdit && (
            <button
              type="button"
              className="pg-tag-x"
              aria-label={`remove tag ${t}`}
              onClick={() => remove(t)}
            >
              ✕
            </button>
          )}
        </span>
      ))}
      {canEdit && <TagPicker options={tagOptions.filter((o) => !tags.includes(o))} onSave={add} />}
    </div>
  );
}
