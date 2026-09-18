"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { basePath } from "@/lib/api-fetch";

/**
 * Inline controls on a project's own item row: toggle done, edit
 * owner/due date, remove. Client islands over an otherwise
 * server-rendered project page, same pattern as DependencyVerifyButton.
 */
export function DoneToggle({ term, itemId, done }: { term: string; itemId: string; done: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function toggle() {
    setBusy(true);
    try {
      const res = await fetch(`${basePath}/api/projects/items`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ term, itemId, done: !done }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      disabled={busy}
      onClick={() => void toggle()}
      className={`proj-check${done ? " proj-check--on" : ""}`}
      title={done ? "Mark open" : "Mark done"}
    >
      {done && (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 8.5l3.2 3.2L13 4.5" />
        </svg>
      )}
    </button>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Due dates are day-level, not moments - format the ISO date's own y/m/d, never through local-timezone Date conversion (that turned Oct 15 into "Oct 14" for anyone west of UTC). */
function formatDueDate(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

export function OwnerDueEditor({ term, itemId, owner, dueDate }: { term: string; itemId: string; owner: string | null; dueDate: string | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [ownerVal, setOwnerVal] = useState(owner ?? "");
  const [dueVal, setDueVal] = useState(dueDate ? dueDate.slice(0, 10) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${basePath}/api/projects/items`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ term, itemId, owner: ownerVal, dueDate: dueVal || null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <button type="button" className="proj-owner-due" onClick={() => setEditing(true)}>
        {owner && <span className="proj-owner">{owner}</span>}
        {dueDate && <span className="proj-due">{formatDueDate(dueDate)}</span>}
        {!owner && !dueDate && <span className="proj-owner-due--empty">+ owner / due date</span>}
      </button>
    );
  }

  return (
    <span className="proj-owner-due-form">
      <input className="stg-input proj-owner-input" placeholder="Owner" value={ownerVal} disabled={busy} onChange={(e) => setOwnerVal(e.target.value)} />
      <input className="stg-input proj-due-input" type="date" value={dueVal} disabled={busy} onChange={(e) => setDueVal(e.target.value)} />
      <button type="button" className="stg-qbtn" disabled={busy} onClick={() => void save()}>{busy ? "..." : "Save"}</button>
      <button type="button" className="stg-qbtn" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
      {error && <span className="stg-dep-verify-error">{error}</span>}
    </span>
  );
}

export function RemoveItemButton({ term, itemId }: { term: string; itemId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`${basePath}/api/projects/items`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ term, itemId }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" className="stg-qbtn stg-qbtn--danger" disabled={busy} onClick={() => void remove()}>
      Remove
    </button>
  );
}

export function AddItemForm({ term }: { term: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState("");
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [owner, setOwner] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${basePath}/api/projects/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ term, slug: slug.trim() || undefined, url: url.trim() || undefined, label: label.trim() || undefined, owner: owner.trim() || undefined, dueDate: dueDate || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setOpen(false);
      setSlug(""); setUrl(""); setLabel(""); setOwner(""); setDueDate("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return <button type="button" className="stg-qbtn" onClick={() => setOpen(true)}>+ Add item</button>;
  }
  return (
    <div className="proj-add-form">
      <input className="stg-input" placeholder="Page slug (curata page)" value={slug} disabled={busy || !!url} onChange={(e) => setSlug(e.target.value)} />
      <span className="proj-add-or">or</span>
      <input className="stg-input" placeholder="https:// (external)" value={url} disabled={busy || !!slug} onChange={(e) => setUrl(e.target.value)} />
      <input className="stg-input" placeholder="Label (external only)" value={label} disabled={busy} onChange={(e) => setLabel(e.target.value)} />
      <input className="stg-input proj-owner-input" placeholder="Owner" value={owner} disabled={busy} onChange={(e) => setOwner(e.target.value)} />
      <input className="stg-input proj-due-input" type="date" value={dueDate} disabled={busy} onChange={(e) => setDueDate(e.target.value)} />
      <button type="button" className="btn btn--primary" disabled={busy || (!slug.trim() && !url.trim())} onClick={() => void submit()}>{busy ? "Adding" : "Add"}</button>
      <button type="button" className="stg-qbtn" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
      {error && <span className="stg-dep-verify-error">{error}</span>}
    </div>
  );
}

export function DeleteProjectButton({ term }: { term: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  async function del() {
    setBusy(true);
    try {
      const res = await fetch(`${basePath}/api/projects`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ term }),
      });
      if (res.ok) router.push("/projects");
    } finally {
      setBusy(false);
    }
  }
  if (!confirm) {
    return <button type="button" className="stg-qbtn stg-qbtn--danger" onClick={() => setConfirm(true)}>Delete project</button>;
  }
  return (
    <span className="proj-delete-confirm">
      <span>Delete this project? Its own items detach; nothing it includes is touched.</span>
      <button type="button" className="stg-qbtn stg-qbtn--danger" disabled={busy} onClick={() => void del()}>{busy ? "Deleting" : "Yes, delete"}</button>
      <button type="button" className="stg-qbtn" disabled={busy} onClick={() => setConfirm(false)}>Cancel</button>
    </span>
  );
}
