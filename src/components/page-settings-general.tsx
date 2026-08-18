"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { basePath } from "@/lib/api-fetch";
import { SettingsSection } from "@/components/settings/settings-section";
import { FormRow } from "@/components/settings/form-row";
import { PageFolderSelect } from "@/components/page-folder-select";
import { toast } from "@/components/toast";

interface FolderOption {
  id: string;
  name: string;
}

interface PageSettingsGeneralProps {
  slug: string;
  visibility: string;
  authMode?: string;
  folderId: string | null;
  folders: FolderOption[];
  canEdit: boolean;
}

const VISIBILITY_OPTIONS = [
  { value: "private", label: "Private" },
  { value: "org", label: "Org" },
  { value: "public", label: "Public" },
] as const;

/**
 * General tab of the page settings hub: visibility, folder assignment, and
 * read-only identity fields (page type, created by/date). Visibility and
 * folder changes each PATCH /api/pages directly — same endpoint the old
 * toolbar VisibilityPicker and PageFolderSelect used, just surfaced here
 * instead of scattered across the page toolbar/command palette.
 */
export function PageSettingsGeneral({
  slug,
  visibility,
  authMode,
  folderId,
  folders,
  canEdit,
}: PageSettingsGeneralProps) {
  const router = useRouter();
  const [current, setCurrent] = useState(visibility);
  const [busy, setBusy] = useState(false);

  const available = authMode === "none"
    ? VISIBILITY_OPTIONS.filter((l) => l.value !== "private")
    : VISIBILITY_OPTIONS;

  async function setVisibility(value: string) {
    if (value === current) return;
    setBusy(true);
    try {
      const res = await fetch(`${basePath}/api/pages`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, visibility: value }),
      });
      if (res.ok) {
        setCurrent(value);
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(`Couldn't update visibility: ${data.error ?? "unknown error"}`);
      }
    } catch {
      toast.error("Couldn't update visibility - check your connection and try again.");
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <SettingsSection title="General" description="Visibility, folder, and identity for this page.">
      <FormRow label="Visibility" hint="Who can view this page.">
        <div className="stg-seg">
          {available.map((l) => (
            <button
              key={l.value}
              className={`stg-seg-btn${l.value === current ? " stg-seg-btn--on" : ""}`}
              disabled={!canEdit || busy}
              onClick={() => setVisibility(l.value)}
            >
              {l.label}
            </button>
          ))}
        </div>
      </FormRow>
      <FormRow label="Folder" hint="Where this page lives in the sidebar.">
        {canEdit ? (
          <PageFolderSelect slug={slug} folderId={folderId} folders={folders} />
        ) : (
          <span className="stg-form-row-hint">
            {folders.find((f) => f.id === folderId)?.name ?? "No folder"}
          </span>
        )}
      </FormRow>
    </SettingsSection>
  );
}
