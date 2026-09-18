"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { basePath } from "@/lib/api-fetch";

/** Client mirror of normalizeTerm: lowercase slug, one interior slash allowed. */
function slugifyTerm(raw: string): string {
  const [head, ...rest] = raw.trim().toLowerCase().split("/");
  const part = (s: string) => s.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const h = part(head ?? ""), t = part(rest.join("-"));
  return h && t ? `${h}/${t}` : h || t;
}

/**
 * "+ Add dependency" on a page's Dependencies tab: names the concept this
 * page depends on directly, same POST the Tags tab's rel picker ends up
 * calling, just in one step instead of add-then-retag. Refreshes the
 * server-rendered tab so both tables (and the map) reflect it immediately.
 */
export function AddDependencyForm({ pageId }: { pageId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalized = slugifyTerm(term);

  async function submit() {
    if (!normalized) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${basePath}/api/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId, tags: [{ term: normalized, rel: "depends" }] }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setOpen(false);
      setTerm("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return <button type="button" className="stg-qbtn" onClick={() => setOpen(true)}>+ Add dependency</button>;
  }
  return (
    <span className="stg-dep-verify-form">
      <input
        autoFocus
        className="stg-input stg-dep-verify-note"
        placeholder="pricing/tier-2"
        value={term}
        disabled={busy}
        onChange={(e) => setTerm(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); void submit(); }
          if (e.key === "Escape") { setOpen(false); setTerm(""); setError(null); }
        }}
      />
      <button type="button" className="stg-qbtn" disabled={busy || !normalized} onClick={() => void submit()}>{busy ? "Adding" : "Add"}</button>
      <button type="button" className="stg-qbtn" disabled={busy} onClick={() => { setOpen(false); setTerm(""); setError(null); }}>Cancel</button>
      {error && <span className="stg-dep-verify-error">{error}</span>}
    </span>
  );
}

/** "Remove" on a Depends-on row: detaches the concept tag entirely (not just its rel). */
export function RemoveDependencyButton({ pageId, term }: { pageId: string; term: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`${basePath}/api/tags`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId, tag: term }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" className="stg-qbtn stg-qbtn--danger" disabled={busy} onClick={() => void remove()}>
      {busy ? "..." : "Remove"}
    </button>
  );
}
