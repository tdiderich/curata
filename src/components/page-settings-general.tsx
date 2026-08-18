"use client";

import { SettingsSection } from "@/components/settings/settings-section";
import { FormRow } from "@/components/settings/form-row";
import { PageFolderSelect } from "@/components/page-folder-select";
import { useVisibility } from "@/hooks/use-visibility";

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

export function PageSettingsGeneral({
  slug,
  visibility,
  authMode,
  folderId,
  folders,
  canEdit,
}: PageSettingsGeneralProps) {
  const { current, busy, available, setVisibility } = useVisibility(slug, visibility, authMode);

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
