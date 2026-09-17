"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { basePath } from "@/lib/api-fetch";

interface DependencyVerifyButtonProps {
  /** Page slug, or... */
  slug?: string;
  /** ...external asset url. Exactly one. */
  url?: string;
  /** Scope an external verify to one concept edge. */
  term?: string;
  /** Button label; "Verify" for a never-checked row, "Re-verify" otherwise. */
  label: string;
}

/**
 * Inline "Verify" action on a Dependencies row. Click opens a one-line note
 * field (why it still holds); Save posts to /api/dependents/verify and
 * refreshes the server-rendered table. Enter saves, Escape cancels.
 */
export function DependencyVerifyButton({ slug, url, term, label }: DependencyVerifyButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${basePath}/api/dependents/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, url, term, note: note.trim() || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setOpen(false);
      setNote("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="stg-qbtn stg-dep-verify-btn" onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }

  return (
    <span className="stg-dep-verify-form">
      <input
        autoFocus
        className="stg-input stg-dep-verify-note"
        placeholder="Why it still holds (optional)"
        value={note}
        maxLength={500}
        disabled={busy}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); void save(); }
          if (e.key === "Escape") { setOpen(false); setNote(""); setError(null); }
        }}
      />
      <button type="button" className="stg-qbtn" disabled={busy} onClick={() => void save()}>
        {busy ? "Saving" : "Save"}
      </button>
      <button type="button" className="stg-qbtn" disabled={busy} onClick={() => { setOpen(false); setNote(""); setError(null); }}>
        Cancel
      </button>
      {error && <span className="stg-dep-verify-error">{error}</span>}
    </span>
  );
}
