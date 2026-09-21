"use client";

import { useState } from "react";
import { basePath } from "@/lib/api-fetch";
import { SettingsSection } from "@/components/settings/settings-section";
import { SettingsTable } from "@/components/settings/settings-table";
import { StatusBadge, type StatusBadgeTone } from "@/components/settings/status-badge";
import { TagPicker, type TagOption } from "@/components/tag-picker";

export type PageTag = { term: string; kind: string; rel?: string };

interface PageSettingsTagsProps {
  pageId: string;
  initialTags: PageTag[];
  tagOptions: PageTag[];
  canEdit: boolean;
  folderTag?: string;
}

const REL_TONE: Record<string, StatusBadgeTone> = {
  depends: "depends",
  asserts: "asserts",
  references: "references",
  instantiates: "instantiates",
};

const KIND_TONE: Record<string, StatusBadgeTone> = {
  topic: "topic",
  vendor: "vendor",
  finding: "finding",
  framework: "framework",
  template: "template",
  component: "component",
};

/** Rels a human picks. instantiates is system-written and stays read-only. */
const PICKABLE_RELS = ["references", "depends", "asserts"] as const;
const REL_HINT: Record<string, string> = {
  references: "Mentions it. Nothing to re-check when it changes.",
  depends: "Goes stale when it changes. Shows up on the map as something to re-check.",
  asserts: "This page is the source of truth for it. Changing this page marks dependents stale.",
  instantiates: "Built from this template by create_from_template.",
  embeds: "Embeds that page's components via a ref block. Written by the scan on save.",
};

export function PageSettingsTags({ pageId, initialTags, tagOptions, canEdit, folderTag }: PageSettingsTagsProps) {
  const [tags, setTags] = useState<PageTag[]>(initialTags);
  const [busyTerm, setBusyTerm] = useState<string | null>(null);

  async function setRel(tag: PageTag, rel: string) {
    if ((tag.rel ?? "references") === rel) return;
    const prev = tags;
    setBusyTerm(tag.term);
    setTags((t) => t.map((x) => (x.term === tag.term ? { ...x, rel } : x)));
    try {
      const res = await fetch(`${basePath}/api/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId, tags: [{ term: tag.term, kind: tag.kind, rel }] }),
      });
      if (!res.ok) setTags(prev);
    } catch {
      setTags(prev);
    } finally {
      setBusyTerm(null);
    }
  }

  async function add(newTags: TagOption[]): Promise<boolean> {
    try {
      const res = await fetch(`${basePath}/api/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId, tags: newTags }),
      });
      if (!res.ok) return false;
      setTags((prev) => {
        const existing = new Set(prev.map((t) => t.term));
        return [...prev, ...newTags.filter((t) => !existing.has(t.term))];
      });
      return true;
    } catch {
      return false;
    }
  }

  async function remove(term: string) {
    const prev = tags;
    setTags((t) => t.filter((tag) => tag.term !== term));
    try {
      const res = await fetch(`${basePath}/api/tags`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId, tag: term }),
      });
      if (!res.ok) setTags(prev);
    } catch {
      setTags(prev);
    }
  }

  const usedTerms = new Set(tags.map((t) => t.term));
  const availableOptions = tagOptions.filter((o) => !usedTerms.has(o.term));
  const hasRows = tags.length > 0 || !!folderTag;

  return (
    <SettingsSection title="Tags" description="Tags place this page in the knowledge graph. Rel says how: references just mentions it, depends means this page goes stale when it changes, asserts means this page is where the truth lives. depends and asserts put it on the map.">
      <SettingsTable
        head={
          <>
            <th className="dash-th dash-th-title" style={{ width: "50%" }}>Tag</th>
            <th className="dash-th">Kind</th>
            <th className="dash-th">Rel</th>
            {canEdit && <th className="dash-th stg-th-right">&nbsp;</th>}
          </>
        }
        empty={!hasRows ? "No tags on this page yet." : undefined}
      >
        {folderTag && (
          <tr className="dash-row" style={{ opacity: 0.65 }}>
            <td className="dash-td dash-td-title">{folderTag}</td>
            <td className="dash-td"><span className="stg-pcount">folder</span></td>
            <td className="dash-td" />
            {canEdit && <td className="dash-td stg-td-right" />}
          </tr>
        )}
        {tags.map((tag) => (
          <tr key={tag.term} className="dash-row">
            <td className="dash-td dash-td-title">{tag.term}</td>
            <td className="dash-td">
              <StatusBadge tone={KIND_TONE[tag.kind] ?? "topic"} label={tag.kind || "topic"} />
            </td>
            <td className="dash-td">
              {canEdit && tag.rel !== "instantiates" ? (
                <div className="stg-seg" role="radiogroup" aria-label={`Relation of ${tag.term} to this page`}>
                  {PICKABLE_RELS.map((rel) => {
                    const on = (tag.rel ?? "references") === rel;
                    return (
                      <button
                        key={rel}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        className={`stg-seg-btn${on ? ` stg-seg-btn--on stg-seg-btn--${rel}` : ""}`}
                        title={REL_HINT[rel]}
                        disabled={busyTerm === tag.term}
                        onClick={() => setRel(tag, rel)}
                      >
                        {rel}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <span title={REL_HINT[tag.rel ?? "references"]}>
                  <StatusBadge tone={REL_TONE[tag.rel ?? "references"] ?? "references"} label={tag.rel ?? "references"} />
                </span>
              )}
            </td>
            {canEdit && (
              <td className="dash-td stg-td-right">
                <span className="stg-row-actions">
                  <button className="stg-qbtn stg-qbtn--danger" onClick={() => remove(tag.term)}>Remove</button>
                </span>
              </td>
            )}
          </tr>
        ))}
      </SettingsTable>

      {canEdit && (
        <div className="stg-composer">
          <TagPicker options={availableOptions} onSave={add} label="+ Add tag" />
        </div>
      )}
    </SettingsSection>
  );
}
