"use client";

import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { basePath } from "@/lib/api-fetch";
import { toast } from "@/components/toast";
import { isPinned, togglePin } from "@/lib/pins";
import { ContentRulesEditor } from "@/components/content-rules-editor";

interface Folder {
  id: string;
  name: string;
  visibility: string;
  parentId?: string | null;
}

// Dropdown menus portal to <body> with fixed positioning so they can't be
// clipped by scroll containers (the sidebar tree, long tables). Position is
// computed from the trigger button and clamped to the viewport, flipping
// above the trigger when there's no room below.
function AnchoredMenu({
  anchorRef,
  menuRef,
  className,
  children,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  menuRef: React.RefObject<HTMLDivElement | null>;
  className: string;
  children: React.ReactNode;
}) {
  const position = useCallback(() => {
    const a = anchorRef.current;
    const m = menuRef.current;
    if (!a || !m) return;
    const r = a.getBoundingClientRect();
    const mw = m.offsetWidth;
    const mh = m.offsetHeight;
    let left = r.right - mw;
    if (left < 8) left = r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
    let top = r.bottom + 4;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
    m.style.left = `${left}px`;
    m.style.top = `${top}px`;
    m.style.visibility = "visible";
  }, [anchorRef, menuRef]);

  // Re-measure every render: menu contents change in place (inline inputs,
  // move-to drill navigation) and the menu must track its anchor.
  useLayoutEffect(() => {
    position();
  });

  useEffect(() => {
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    // The menu changes size after mount (fonts, inline inputs, drill
    // navigation) — re-clamp whenever it does.
    const ro = new ResizeObserver(position);
    if (menuRef.current) ro.observe(menuRef.current);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      ro.disconnect();
    };
  }, [position, menuRef]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={menuRef}
      className={className}
      style={{ position: "fixed", top: 0, left: 0, right: "auto", visibility: "hidden", zIndex: 10000 }}
    >
      {children}
    </div>,
    document.body
  );
}

// ── New folder inline input ───────────────────────────────────────────────────

export function NewFolderButton({
  className = "dash-new-folder-btn",
  label = "+ New folder",
}: {
  className?: string;
  label?: string;
} = {}) {
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
        toast.error(`Couldn't create folder: ${data.error ?? "unknown error"}`);
      }
    } catch {
      toast.error("Couldn't create folder — check your connection and try again.");
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
          {busy ? "Creating…" : "Create"}
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
    <button className={className} onClick={() => setCreating(true)}>
      {label}
    </button>
  );
}

// ── Per-page "..." dropdown ──────────────────────────────────────────────────

interface PageMenuProps {
  slug: string;
  title: string;
  folderId: string | null;
  folders: Folder[];
  visibility?: string;
  orgSlug?: string;
  authMode?: string;
}

export function PageMenu({ slug, title, folderId, folders, visibility = "org", orgSlug = "default", authMode = "none" }: PageMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [visOpen, setVisOpen] = useState(false);
  const [currentVis, setCurrentVis] = useState(visibility);
  const [browseParent, setBrowseParent] = useState<string | null | undefined>(undefined);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || portalRef.current?.contains(t)) return;
      setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  async function patchPage(body: Record<string, unknown>, failMsg: string) {
    setBusy(true);
    setOpen(false);
    try {
      const res = await fetch(`${basePath}/api/pages`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, ...body }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        toast.error(`${failMsg}: ${data.error ?? "unknown error"}`);
      }
    } catch {
      toast.error(`${failMsg} — check your connection and try again.`);
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  function moveTo(targetFolderId: string | null) {
    return patchPage({ folderId: targetFolderId }, "Couldn't move page");
  }

  async function copyLink() {
    const url = currentVis === "public"
      ? `${window.location.origin}${basePath.replace(/\/$/, "")}/p/${orgSlug}/${slug}`
      : `${window.location.origin}${basePath}/pages/${encodeURIComponent(slug)}`;
    await navigator.clipboard.writeText(url);
    toast.success(currentVis === "public" ? "Public link copied" : "Link copied");
    setOpen(false);
  }

  async function doDelete() {
    setOpen(false);
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`${basePath}/api/pages?slug=${encodeURIComponent(slug)}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(`Couldn't delete page: ${data.error ?? "unknown error"}`);
      } else {
        toast.success(`Deleted "${title}"`);
      }
    } catch {
      toast.error("Couldn't delete page — check your connection and try again.");
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  const viewingParent = browseParent === undefined ? "__root" : browseParent;
  const visibleFolders = folders.filter((f) => {
    if (viewingParent === "__root") return !f.parentId;
    return f.parentId === viewingParent;
  });
  const parentFolder = viewingParent !== "__root" && viewingParent
    ? folders.find((f) => f.id === viewingParent)
    : null;
  const hasChildren = (fId: string) => folders.some((f) => f.parentId === fId);

  return (
    <div ref={menuRef} className="dash-page-actions">
      <button
        ref={btnRef}
        className="dash-page-actions-btn"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); setMoveOpen(false); setVisOpen(false); setBrowseParent(undefined); }}
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
        <AnchoredMenu anchorRef={btnRef} menuRef={portalRef} className="dash-page-actions-menu">
          <button className="dash-page-actions-item" onClick={copyLink}>
            Copy link
          </button>
          <div className="dash-page-actions-divider" />
          {!moveOpen ? (
            <button
              className="dash-page-actions-item"
              onClick={() => { setMoveOpen(true); setBrowseParent(undefined); }}
            >
              Move
            </button>
          ) : (
            <>
              <button
                className="dash-page-actions-item dash-folder-actions-back"
                onClick={() => {
                  if (viewingParent !== "__root") {
                    if (parentFolder?.parentId) setBrowseParent(parentFolder.parentId);
                    else setBrowseParent(undefined);
                  } else {
                    setMoveOpen(false);
                  }
                }}
              >
                <span className="dash-folder-actions-arrow">&#8592;</span>
                {viewingParent !== "__root" && parentFolder ? parentFolder.name : "Back"}
              </button>
              <button
                className={`dash-page-actions-item${folderId === (viewingParent === "__root" ? null : viewingParent) ? " dash-page-actions-item--active" : ""}`}
                onClick={() => moveTo(viewingParent === "__root" ? null : viewingParent!)}
              >
                {viewingParent === "__root" ? "No folder" : "Here"}
                {folderId === (viewingParent === "__root" ? null : viewingParent) && (
                  <span className="dash-page-actions-check">&#10003;</span>
                )}
              </button>
              {visibleFolders.map((f) => (
                <div key={f.id} className="dash-folder-actions-move-row">
                  <button
                    className={`dash-folder-actions-item dash-folder-actions-move-target${folderId === f.id ? " dash-folder-actions-item--active" : ""}`}
                    onClick={() => moveTo(f.id)}
                  >
                    {f.name}
                    {folderId === f.id && <span className="dash-page-actions-check">&#10003;</span>}
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
          )}
          <div className="dash-page-actions-divider" />
          <button
            className="dash-page-actions-item"
            onClick={() => {
              setOpen(false);
              const nowPinned = togglePin(slug);
              toast.success(nowPinned ? `Pinned "${title}"` : `Unpinned "${title}"`);
            }}
          >
            {isPinned(slug) ? "Unpin from top" : "Pin to top"}
          </button>
          <div className="dash-page-actions-divider" />
          {!visOpen ? (
            <button
              className="dash-page-actions-item"
              onClick={() => { setVisOpen(true); setMoveOpen(false); }}
            >
              Visibility
            </button>
          ) : (
            <>
              <button
                className="dash-page-actions-item dash-folder-actions-back"
                onClick={() => setVisOpen(false)}
              >
                <span className="dash-folder-actions-arrow">&#8592;</span>
                Back
              </button>
              {(["private", "org", "public"] as const).filter((v) => v !== "private" || authMode !== "none").map((v) => (
                <button
                  key={v}
                  className={`dash-page-actions-item${v === currentVis ? " dash-page-actions-item--active" : ""}`}
                  onClick={async () => {
                    if (v === currentVis) return;
                    setBusy(true);
                    setOpen(false);
                    setVisOpen(false);
                    try {
                      const res = await fetch(`${basePath}/api/pages`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ slug, visibility: v }),
                      });
                      if (res.ok) {
                        setCurrentVis(v);
                      } else {
                        const data = (await res.json().catch(() => ({}))) as { error?: string };
                        toast.error(`Couldn't update visibility: ${data.error ?? "unknown error"}`);
                      }
                    } catch {
                      toast.error("Couldn't update visibility — check your connection and try again.");
                    } finally {
                      setBusy(false);
                      router.refresh();
                    }
                  }}
                >
                  {v === "private" ? "Private" : v === "org" ? "Org" : "Public"}
                  {v === currentVis && <span className="dash-page-actions-check">&#10003;</span>}
                </button>
              ))}
            </>
          )}
          <div className="dash-page-actions-divider" />
          <button
            className="dash-page-actions-item dash-page-actions-item--danger"
            onClick={doDelete}
          >
            Delete
          </button>
        </AnchoredMenu>
      )}
    </div>
  );
}

// ── Per-folder "..." dropdown ─────────────────────────────────────────────────

interface FolderMenuProps {
  folder: Folder;
  allFolders?: Folder[];
  canManageRules?: boolean;
}

export function FolderMenu({ folder, allFolders = [], canManageRules = false }: FolderMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(folder.name);
  const [busy, setBusy] = useState(false);
  const [browseParent, setBrowseParent] = useState<string | null | undefined>(undefined);
  const [addingChild, setAddingChild] = useState(false);
  const [childName, setChildName] = useState("");
  const [rulesOpen, setRulesOpen] = useState(false);
  const [folderRules, setFolderRules] = useState<Array<{ id: string; text: string; mode: "warn" | "block"; patterns?: string[] }>>([]);
  const [rulesLoaded, setRulesLoaded] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const childInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) inputRef.current?.focus();
  }, [renaming]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || portalRef.current?.contains(t)) return;
      setOpen(false);
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
        toast.error(`Couldn't rename folder: ${data.error ?? "unknown error"}`);
      }
    } catch {
      toast.error("Couldn't rename folder — check your connection and try again.");
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
        toast.error(`Couldn't move folder: ${data.error ?? "unknown error"}`);
      }
    } catch {
      toast.error("Couldn't move folder — check your connection and try again.");
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  async function doDelete() {
    setOpen(false);
    if (!confirm(`Delete folder "${folder.name}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`${basePath}/api/folders`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: folder.id }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        toast.error(`Couldn't delete folder: ${data.error ?? "unknown error"}`);
      } else {
        toast.success(`Deleted folder "${folder.name}"`);
      }
    } catch {
      toast.error("Couldn't delete folder — check your connection and try again.");
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

  async function openFolderRules() {
    setOpen(false);
    if (!rulesLoaded) {
      try {
        const res = await fetch(`${basePath}/api/rules?scope=folder:${folder.id}`);
        if (res.ok) {
          const data = await res.json() as { rules: Array<{ id: string; text: string; mode: "warn" | "block"; patterns?: string[] }> };
          setFolderRules(data.rules);
        }
      } catch { /* ignore */ }
      setRulesLoaded(true);
    }
    setRulesOpen(true);
  }

  async function createPageHere() {
    setBusy(true);
    setOpen(false);
    try {
      const res = await fetch(`${basePath}/api/pages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Untitled", shell: "standard" }),
      });
      const data = (await res.json()) as { slug?: string; error?: string };
      if (!res.ok || !data.slug) {
        toast.error(`Couldn't create page: ${data.error ?? "unknown error"}`);
        return;
      }
      const moveRes = await fetch(`${basePath}/api/pages`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: data.slug, folderId: folder.id }),
      });
      if (!moveRes.ok) {
        toast.error(`Page created but couldn't move it into "${folder.name}" — find it under No Folder.`);
      }
      router.push(`/pages/${data.slug}?edit=1`);
    } catch {
      toast.error("Couldn't create page — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

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
        toast.error(`Couldn't create folder: ${data.error ?? "unknown error"}`);
      }
    } catch {
      toast.error("Couldn't create folder — check your connection and try again.");
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
          {busy ? "Saving…" : "Save"}
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
        ref={btnRef}
        className="dash-folder-actions-btn"
        onClick={() => { setOpen((v) => !v); setBrowseParent(undefined); setAddingChild(false); setChildName(""); }}
        aria-label="Folder options"
      >
        &bull;&bull;&bull;
      </button>
      {open && (
        <AnchoredMenu anchorRef={btnRef} menuRef={portalRef} className="dash-folder-actions-menu">
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
            className="dash-folder-actions-item"
            onClick={createPageHere}
            disabled={busy}
          >
            + Add page
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
                {busy ? "Creating…" : "Create"}
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
          {canManageRules && (
            <button
              className="dash-folder-actions-item"
              onClick={openFolderRules}
            >
              Content rules
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
        </AnchoredMenu>
      )}
      {rulesOpen && typeof document !== "undefined" && createPortal(
        <div className="rules-panel-overlay" onClick={() => { setRulesOpen(false); setRulesLoaded(false); }}>
          <div className="rules-panel" onClick={(e) => e.stopPropagation()}>
            <div className="rules-panel-header">
              <span className="rules-panel-title">Content Rules: {folder.name}</span>
              <button className="rules-panel-close" onClick={() => { setRulesOpen(false); setRulesLoaded(false); }}>&times;</button>
            </div>
            <div className="rules-panel-body" style={{ padding: "12px 20px" }}>
              <ContentRulesEditor
                scopeParam={`scope=folder:${folder.id}`}
                initialRules={folderRules}
                canManage={canManageRules}
              />
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
