"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

interface Folder {
  id: string;
  name: string;
  visibility: string;
}

// ── New folder inline input ───────────────────────────────────────────────────

export function NewFolderButton() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        console.error("[folder] create failed:", data.error);
      }
    } catch (err) {
      console.error("[folder] create error:", err);
    } finally {
      setBusy(false);
      setCreating(false);
      setName("");
      router.refresh();
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") submit();
    if (e.key === "Escape") {
      setCreating(false);
      setName("");
    }
  }

  if (creating) {
    return (
      <div className="dash-new-folder">
        <input
          ref={inputRef}
          className="dash-new-folder-input"
          placeholder="Folder name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={busy}
        />
        <button
          className="dash-new-folder-submit"
          onClick={submit}
          disabled={busy || !name.trim()}
        >
          {busy ? "..." : "Create"}
        </button>
        <button
          className="dash-new-folder-cancel"
          onClick={() => {
            setCreating(false);
            setName("");
          }}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button className="dash-new-folder-btn" onClick={() => setCreating(true)}>
      + New folder
    </button>
  );
}

// ── Per-folder "..." dropdown ─────────────────────────────────────────────────

interface FolderMenuProps {
  folder: Folder;
}

export function FolderMenu({ folder }: FolderMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(folder.name);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) inputRef.current?.focus();
  }, [renaming]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  async function doRename() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === folder.name) {
      setRenaming(false);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/folders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: folder.id, name: trimmed }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        console.error("[folder] rename failed:", data.error);
      }
    } catch (err) {
      console.error("[folder] rename error:", err);
    } finally {
      setBusy(false);
      setRenaming(false);
      router.refresh();
    }
  }

  async function doDelete() {
    setOpen(false);
    setBusy(true);
    try {
      const res = await fetch("/api/folders", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: folder.id }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        console.error("[folder] delete failed:", data.error);
      }
    } catch (err) {
      console.error("[folder] delete error:", err);
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") doRename();
    if (e.key === "Escape") {
      setRenaming(false);
      setName(folder.name);
    }
  }

  if (renaming) {
    return (
      <div className="dash-new-folder" style={{ display: "inline-flex" }}>
        <input
          ref={inputRef}
          className="dash-new-folder-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={busy}
        />
        <button
          className="dash-new-folder-submit"
          onClick={doRename}
          disabled={busy}
        >
          {busy ? "..." : "Save"}
        </button>
        <button
          className="dash-new-folder-cancel"
          onClick={() => {
            setRenaming(false);
            setName(folder.name);
          }}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div ref={menuRef} className="dash-folder-actions">
      <button
        className="dash-folder-actions-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label="Folder options"
      >
        &bull;&bull;&bull;
      </button>
      {open && (
        <div className="dash-folder-actions-menu">
          <button
            className="dash-folder-actions-item"
            onClick={() => {
              setOpen(false);
              setRenaming(true);
            }}
          >
            Rename
          </button>
          <button
            className="dash-folder-actions-item dash-folder-actions-item--danger"
            onClick={doDelete}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
