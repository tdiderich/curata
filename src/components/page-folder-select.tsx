"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface FolderOption {
  id: string;
  name: string;
}

interface PageFolderSelectProps {
  slug: string;
  folderId: string | null;
  folders: FolderOption[];
}

export function PageFolderSelect({
  slug,
  folderId,
  folders,
}: PageFolderSelectProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    const newFolderId = value === "" ? null : value;
    setBusy(true);
    try {
      const res = await fetch("/api/pages", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, folderId: newFolderId }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        console.error("[page] folder update failed:", data.error);
      }
    } catch (err) {
      console.error("[page] folder update error:", err);
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <select
      className="dash-page-folder-select"
      value={folderId ?? ""}
      onChange={onChange}
      disabled={busy}
      aria-label="Move to folder"
    >
      <option value="">No folder</option>
      {folders.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name}
        </option>
      ))}
    </select>
  );
}

// ── Visibility toggle ─────────────────────────────────────────────────────────

const VISIBILITY_CYCLE: Record<string, string> = {
  personal: "shared",
  shared: "public",
  public: "personal",
};

interface VisibilityBadgeProps {
  slug: string;
  visibility: string;
}

export function VisibilityBadge({ slug, visibility }: VisibilityBadgeProps) {
  const router = useRouter();
  const [current, setCurrent] = useState(visibility);
  const [busy, setBusy] = useState(false);

  async function cycle() {
    const next = VISIBILITY_CYCLE[current] ?? "personal";
    setBusy(true);
    try {
      const res = await fetch("/api/pages", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, visibility: next }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        console.error("[page] visibility update failed:", data.error);
        return;
      }
      setCurrent(next);
    } catch (err) {
      console.error("[page] visibility update error:", err);
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  const label =
    current === "personal" ? "private" : current === "shared" ? "shared" : "public";

  return (
    <button
      className={`dash-visibility-badge dash-visibility-badge--${current}`}
      onClick={cycle}
      disabled={busy}
      title={`Visibility: ${current}. Click to change.`}
    >
      {label}
    </button>
  );
}
