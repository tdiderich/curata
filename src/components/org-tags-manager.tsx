"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { basePath } from "@/lib/api-fetch";
import { TagPicker } from "./tag-picker";
import { SettingsSection } from "@/components/settings/settings-section";

/**
 * Owner/admin surface for the recommended organization tags. They render as
 * the Organization tier in the knowledge graph and are pushed to every
 * connected agent in the MCP server instructions.
 */
export function OrgTagsManager({
  initialTags,
  suggestions,
  canManage,
}: {
  initialTags: string[];
  suggestions: string[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [tags, setTags] = useState(initialTags);
  const [error, setError] = useState<string | null>(null);

  const put = async (next: string[]) => {
    setError(null);
    const res = await fetch(`${basePath}/api/org-tags`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: next }),
    }).catch(() => null);
    if (res?.ok) {
      const data = (await res.json()) as { tags: string[] };
      setTags(data.tags);
      router.refresh();
      return true;
    }
    setError("Failed to save organization tags.");
    return false;
  };

  return (
    <SettingsSection
      title="Organization tags"
      description="Recommended tags show as the Organization tier in the knowledge graph and are suggested to every connected agent."
    >
      {error && <div className="members-error">{error}</div>}
      <div className="stg-chip-row">
        {tags.map((t) => (
          <span key={t} className="stg-chip">
            {t}
            {canManage && (
              <button
                type="button"
                className="stg-chip-x"
                aria-label={`remove ${t}`}
                onClick={() => put(tags.filter((x) => x !== t))}
              >
                &times;
              </button>
            )}
          </span>
        ))}
        {tags.length === 0 && <span className="org-tags-empty">No recommended tags yet.</span>}
        {canManage && (
          <TagPicker
            label="recommend tags"
            options={suggestions.filter((s) => !tags.includes(s)).map((term) => ({ term, kind: "" }))}
            onSave={(added) => put([...tags, ...added.map((a) => a.term)])}
          />
        )}
      </div>
    </SettingsSection>
  );
}
