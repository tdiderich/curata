"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { basePath } from "@/lib/api-fetch";

interface Folder {
  id: string;
  name: string;
  visibility: string;
  parentId?: string | null;
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
      const res = await fetch(`${basePath}/api/folders`, {
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

// ── Per-page "..." dropdown ──────────────────────────────────────────────────

interface PageMenuFolder {
  id: string;
  name: string;
}

interface PageMenuProps {
  slug: string;
  title: string;
  visibility: string;
  folderId: string | null;
  folders: PageMenuFolder[];
}

export function PageMenu({ slug, title, visibility, folderId, folders }: PageMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  async function setVisibility(v: string) {
    setBusy(true);
    setOpen(false);
    try {
      await fetch(`${basePath}/api/pages`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, visibility: v }),
      });
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  async function moveTo(targetFolderId: string | null) {
    setBusy(true);
    setOpen(false);
    try {
      await fetch(`${basePath}/api/pages`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, folderId: targetFolderId }),
      });
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  async function doDelete() {
    setOpen(false);
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await fetch(`${basePath}/api/pages?slug=${encodeURIComponent(slug)}`, { method: "DELETE" });
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  const visOptions = [
    { value: "personal", label: "Private" },
    { value: "shared", label: "Shared" },
    { value: "public", label: "Public" },
  ];

  return (
    <div ref={menuRef} className="dash-page-actions">
      <button
        className="dash-page-actions-btn"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        disabled={busy}
        aria-label="Page options"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="8" cy="3" r="1.5" />
          <circle cx="8" cy="8" r="1.5" />
          <circle cx="8" cy="13" r="1.5" />
        </svg>
      </button>
      {open && (
        <div className="dash-page-actions-menu" onClick={(e) => e.stopPropagation()}>
          <div className="dash-page-actions-section">Visibility</div>
          {visOptions.map((o) => (
            <button
              key={o.value}
              className={`dash-page-actions-item${visibility === o.value ? " dash-page-actions-item--active" : ""}`}
              onClick={() => setVisibility(o.value)}
            >
              {o.label}
              {visibility === o.value && <span className="dash-page-actions-check">&#10003;</span>}
            </button>
          ))}
          <div className="dash-page-actions-divider" />
          <div className="dash-page-actions-section">Move to</div>
          <button
            className={`dash-page-actions-item${folderId === null ? " dash-page-actions-item--active" : ""}`}
            onClick={() => moveTo(null)}
          >
            No folder
            {folderId === null && <span className="dash-page-actions-check">&#10003;</span>}
          </button>
          {folders.map((f) => (
            <button
              key={f.id}
              className={`dash-page-actions-item${folderId === f.id ? " dash-page-actions-item--active" : ""}`}
              onClick={() => moveTo(f.id)}
            >
              {f.name}
              {folderId === f.id && <span className="dash-page-actions-check">&#10003;</span>}
            </button>
          ))}
          <div className="dash-page-actions-divider" />
          <button
            className="dash-page-actions-item dash-page-actions-item--danger"
            onClick={doDelete}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

// ── Per-folder "..." dropdown ─────────────────────────────────────────────────

interface FolderMenuProps {
  folder: Folder;
  allFolders?: Folder[];
}

export function FolderMenu({ folder, allFolders = [] }: FolderMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(folder.name);
  const [busy, setBusy] = useState(false);
  const [browseParent, setBrowseParent] = useState<string | null | undefined>(undefined);
  const [addingChild, setAddingChild] = useState(false);
  const [childName, setChildName] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const childInputRef = useRef<HTMLInputElement>(null);

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
      const res = await fetch(`${basePath}/api/folders`, {
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

  async function moveToFolder(parentId: string | null) {
    setBusy(true);
    setOpen(false);
    try {
      const res = await fetch(`${basePath}/api/folders`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: folder.id, parentId }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        console.error("[folder] move failed:", data.error);
      }
    } catch (err) {
      console.error("[folder] move error:", err);
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  async function doDelete() {
    setOpen(false);
    setBusy(true);
    try {
      const res = await fetch(`${basePath}/api/folders`, {
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

  useEffect(() => {
    if (addingChild) childInputRef.current?.focus();
  }, [addingChild]);

  async function createChild() {
    const trimmed = childName.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const res = await fetch(`${basePath}/api/folders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, parentId: folder.id }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        console.error("[folder] create child failed:", data.error);
      }
    } catch (err) {
      console.error("[folder] create child error:", err);
    } finally {
      setBusy(false);
      setAddingChild(false);
      setChildName("");
      setOpen(false);
      router.refresh();
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
        onClick={() => { setOpen((v) => !v); setBrowseParent(undefined); setAddingChild(false); setChildName(""); }}
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
          {addingChild ? (
            <div className="dash-folder-actions-inline-create">
              <input
                ref={childInputRef}
                className="dash-new-folder-input"
                placeholder="Folder name"
                value={childName}
                onChange={(e) => setChildName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") createChild();
                  if (e.key === "Escape") { setAddingChild(false); setChildName(""); }
                }}
                disabled={busy}
              />
              <button className="dash-new-folder-submit" onClick={createChild} disabled={busy || !childName.trim()}>
                {busy ? "..." : "Create"}
              </button>
            </div>
          ) : (
            <button
              className="dash-folder-actions-item"
              onClick={() => setAddingChild(true)}
            >
              + Add folder
            </button>
          )}
          {allFolders.length > 0 && (() => {
            const viewingParent = browseParent === undefined ? "__root" : browseParent;
            const visibleFolders = allFolders.filter((f) => {
              if (f.id === folder.id) return false;
              if (viewingParent === "__root") return !f.parentId;
              return f.parentId === viewingParent;
            });
            const parentFolder = viewingParent !== "__root" && viewingParent
              ? allFolders.find((f) => f.id === viewingParent)
              : null;
            const hasChildren = (fId: string) => allFolders.some((f) => f.parentId === fId && f.id !== folder.id);
            return (
              <>
                <div className="dash-page-actions-divider" />
                <div className="dash-page-actions-section">Move to</div>
                {viewingParent !== "__root" && (
                  <button
                    className="dash-folder-actions-item dash-folder-actions-back"
                    onClick={() => {
                      if (parentFolder?.parentId) setBrowseParent(parentFolder.parentId);
                      else setBrowseParent(undefined);
                    }}
                  >
                    <span className="dash-folder-actions-arrow">&#8592;</span>
                    {parentFolder ? parentFolder.name : "Back"}
                  </button>
                )}
                <button
                  className={`dash-folder-actions-item${folder.parentId === (viewingParent === "__root" ? null : viewingParent) ? " dash-folder-actions-item--active" : ""}`}
                  onClick={() => moveToFolder(viewingParent === "__root" ? null : viewingParent!)}
                >
                  {viewingParent === "__root" ? "Top level" : "Here"}
                  {folder.parentId === (viewingParent === "__root" ? null : viewingParent) && (
                    <span className="dash-page-actions-check">&#10003;</span>
                  )}
                </button>
                {visibleFolders.map((f) => (
                  <div key={f.id} className="dash-folder-actions-move-row">
                    <button
                      className={`dash-folder-actions-item dash-folder-actions-move-target${folder.parentId === f.id ? " dash-folder-actions-item--active" : ""}`}
                      onClick={() => moveToFolder(f.id)}
                    >
                      {f.name}
                      {folder.parentId === f.id && <span className="dash-page-actions-check">&#10003;</span>}
                    </button>
                    {hasChildren(f.id) && (
                      <button
                        className="dash-folder-actions-drill"
                        onClick={() => setBrowseParent(f.id)}
                        aria-label={`Browse ${f.name}`}
                      >
                        &#8250;
                      </button>
                    )}
                  </div>
                ))}
              </>
            );
          })()}
          <div className="dash-page-actions-divider" />
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
