"use client";

import { useState } from "react";
import { basePath } from "@/lib/api-fetch";
import { SettingsSection } from "@/components/settings/settings-section";
import { SettingsTable } from "@/components/settings/settings-table";
import { StatusBadge, type StatusBadgeTone } from "@/components/settings/status-badge";
import { TagPicker, type TagOption } from "@/components/tag-picker";

export type PageTag = { term: string; kind: string };

interface PageSettingsTagsProps {
  pageId: string;
  initialTags: PageTag[];
  tagOptions: PageTag[];
  canEdit: boolean;
  folderTag?: string;
}

const KIND_TONE: Record<string, StatusBadgeTone> = {
  topic: "topic",
  vendor: "vendor",
  finding: "finding",
  framework: "framework",
};

export function PageSettingsTags({ pageId, initialTags, tagOptions, canEdit, folderTag }: PageSettingsTagsProps) {
  const [tags, setTags] = useState<PageTag[]>(initialTags);

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
    <SettingsSection title="Tags" description="Tags place this page in the knowledge graph and the agents' brain map.">
      <SettingsTable
        head={
          <>
            <th className="dash-th dash-th-title" style={{ width: "50%" }}>Tag</th>
            <th className="dash-th">Kind</th>
            {canEdit && <th className="dash-th stg-th-right">&nbsp;</th>}
          </>
        }
        empty={!hasRows ? "No tags on this page yet." : undefined}
      >
        {folderTag && (
          <tr className="dash-row" style={{ opacity: 0.65 }}>
            <td className="dash-td dash-td-title">{folderTag}</td>
            <td className="dash-td"><span className="stg-pcount">folder</span></td>
            {canEdit && <td className="dash-td stg-td-right" />}
          </tr>
        )}
        {tags.map((tag) => (
          <tr key={tag.term} className="dash-row">
            <td className="dash-td dash-td-title">{tag.term}</td>
            <td className="dash-td">
              <StatusBadge tone={KIND_TONE[tag.kind] ?? "topic"} label={tag.kind || "topic"} />
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
