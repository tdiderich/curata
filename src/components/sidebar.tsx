"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { basePath } from "@/lib/api-fetch";
import { toast } from "@/components/toast";
import { FolderMenu, PageMenu, NewFolderButton } from "@/components/folder-actions";
import { NewPageButton } from "@/components/new-page-button";
import { readPinsSeeded, PINS_CHANGED_EVENT } from "@/lib/pins";

export interface SidebarFolder {
  id: string;
  name: string;
  parentId: string | null;
  visibility: string;
}

export interface SidebarPage {
  slug: string;
  title: string;
  folderId: string | null;
  pinned: boolean;
  visibility: string;
}

interface RecentEntry {
  slug: string;
  title: string;
  ts: number;
}

// Folders default collapsed; the store tracks what the user explicitly
// expanded (so new folders also arrive collapsed).
const EXPAND_KEY = "curata-nav-expanded";
const HIDDEN_KEY = "curata-nav-hidden";
// dataTransfer payload type for page rows dragged onto folders.
const DRAG_MIME = "application/x-curata-page";

function readExpanded(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(EXPAND_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function readRecents(): RecentEntry[] {
  try {
    return JSON.parse(localStorage.getItem("curata-recent") ?? "[]") as RecentEntry[];
  } catch {
    return [];
  }
}

function folderPath(folderId: string | null, folders: SidebarFolder[]): string {
  if (!folderId) return "";
  const byId = new Map(folders.map((f) => [f.id, f]));
  const parts: string[] = [];
  let cur = folderId;
  while (cur) {
    const f = byId.get(cur);
    if (!f) break;
    parts.unshift(f.name);
    cur = f.parentId!;
  }
  return parts.join(" › ");
}

function PageLink({ page, folders, active, pinned }: { page: SidebarPage; folders: SidebarFolder[]; active: boolean; pinned: boolean }) {
  return (
    <div
      className={`nav-page-row${active ? " nav-page-row--active" : ""}`}
      data-tip={(() => { const path = folderPath(page.folderId, folders); return path ? `${path} › ${page.title}` : page.title; })()}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ slug: page.slug, folderId: page.folderId, title: page.title }));
        e.dataTransfer.effectAllowed = "move";
      }}
    >
      <Link href={`/pages/${page.slug}`} className="nav-page-link">
        <svg className="nav-page-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        <span className="nav-page-title">{page.title}</span>
        {pinned && <span className="nav-page-pin" aria-label="Pinned">&#9733;</span>}
      </Link>
      <span className="nav-row-menu">
        <PageMenu
          slug={page.slug}
          title={page.title}
          visibility={page.visibility}
          folderId={page.folderId}
          folders={folders}
        />
      </span>
    </div>
  );
}

export function Sidebar({
  folders,
  pages,
  archivedPages = [],
  orgName,
  logoUrl,
  cleanupCount = 0,
  authControls,
}: {
  folders: SidebarFolder[];
  pages: SidebarPage[];
  archivedPages?: SidebarPage[];
  orgName: string;
  logoUrl?: string | null;
  cleanupCount?: number;
  authControls?: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const sidebarRef = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [recents, setRecents] = useState<RecentEntry[]>([]);
  const [pins, setPins] = useState<string[]>([]);
  const [hidden, setHidden] = useState(false);
  // Folder id (or "__root") currently hovered by a page drag.
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    const el = sidebarRef.current;
    if (!el) return;
    const saved = localStorage.getItem("curata-sidebar-width");
    if (saved) el.style.width = saved + "px";
  }, []);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setResizing(true);
    const el = sidebarRef.current;
    if (!el) return;
    const startX = e.clientX;
    const startW = el.offsetWidth;
    function onMove(ev: MouseEvent) {
      const w = Math.min(480, Math.max(200, startW + ev.clientX - startX));
      el!.style.width = w + "px";
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setResizing(false);
      localStorage.setItem("curata-sidebar-width", String(el!.offsetWidth));
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpanded(readExpanded());
    setRecents(readRecents());
  }, [pathname]);

  useEffect(() => {
    const sync = () => setPins(readPinsSeeded(pages.filter((p) => p.pinned).map((p) => p.slug)));
    sync();
    window.addEventListener(PINS_CHANGED_EVENT, sync);
    return () => window.removeEventListener(PINS_CHANGED_EVENT, sync);
  }, [pages]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHidden(localStorage.getItem(HIDDEN_KEY) === "1");
  }, []);

  const toggleHidden = () =>
    setHidden((h) => {
      localStorage.setItem(HIDDEN_KEY, h ? "0" : "1");
      return !h;
    });

  // ⌘\ / Ctrl+\ toggles the sidebar (Notion convention).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        setHidden((h) => {
          localStorage.setItem(HIDDEN_KEY, h ? "0" : "1");
          return !h;
        });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function dropPage(e: React.DragEvent, targetFolderId: string | null) {
    e.preventDefault();
    setDropTarget(null);
    let payload: { slug: string; folderId: string | null; title: string };
    try {
      payload = JSON.parse(e.dataTransfer.getData(DRAG_MIME));
    } catch {
      return;
    }
    if (!payload?.slug || payload.folderId === targetFolderId) return;
    try {
      const res = await fetch(`${basePath}/api/pages`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: payload.slug, folderId: targetFolderId }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(`Couldn't move page: ${data.error ?? "unknown error"}`);
      } else {
        toast.success(`Moved "${payload.title}"`);
      }
    } catch {
      toast.error("Couldn't move page — check your connection and try again.");
    } finally {
      router.refresh();
    }
  }

  function dropProps(targetId: string | null): React.HTMLAttributes<HTMLDivElement> {
    const key = targetId ?? "__root";
    return {
      onDragOver: (e) => {
        if (e.dataTransfer.types.includes(DRAG_MIME)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setDropTarget(key);
        }
      },
      onDragLeave: () => setDropTarget((cur) => (cur === key ? null : cur)),
      onDrop: (e) => dropPage(e, targetId),
    };
  }

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem(EXPAND_KEY, JSON.stringify([...next]));
      return next;
    });
  };

  const childFolders = useMemo(() => {
    const m = new Map<string | null, SidebarFolder[]>();
    for (const f of folders) {
      const key = f.parentId ?? null;
      const list = m.get(key) ?? [];
      list.push(f);
      m.set(key, list);
    }
    return m;
  }, [folders]);

  const pagesByFolder = useMemo(() => {
    const m = new Map<string | null, SidebarPage[]>();
    for (const p of pages) {
      const key = p.folderId ?? null;
      const list = m.get(key) ?? [];
      list.push(p);
      m.set(key, list);
    }
    return m;
  }, [pages]);

  // Per-user pins: order follows the pin list (oldest pin first).
  const pinned = useMemo(() => {
    const bySlug = new Map(pages.map((p) => [p.slug, p]));
    return pins.map((s) => bySlug.get(s)).filter((p): p is SidebarPage => !!p);
  }, [pages, pins]);
  const pinnedSet = useMemo(() => new Set(pins), [pins]);
  const knownSlugs = useMemo(() => new Set(pages.map((p) => p.slug)), [pages]);
  const recentList = useMemo(
    () => recents.filter((r) => knownSlugs.has(r.slug) && !pinned.some((p) => p.slug === r.slug)).slice(0, 4),
    [recents, knownSlugs, pinned]
  );

  const activeSlug = pathname.startsWith("/pages/")
    ? decodeURIComponent(pathname.slice("/pages/".length).split("/")[0])
    : null;

  function renderFolder(folder: SidebarFolder, depth: number) {
    const isCollapsed = !expanded.has(folder.id);
    const kids = childFolders.get(folder.id) ?? [];
    const folderPages = pagesByFolder.get(folder.id) ?? [];
    return (
      <div key={folder.id} className="nav-folder" style={{ "--nav-depth": depth } as React.CSSProperties}>
        <div
          className={`nav-folder-row${dropTarget === folder.id ? " nav-folder-row--dragover" : ""}`}
          data-tip={(() => { const path = folderPath(folder.parentId, folders); return path ? `${path} › ${folder.name}` : folder.name; })()}
          {...dropProps(folder.id)}
        >
          <button
            className="nav-folder-toggle"
            onClick={() => toggle(folder.id)}
            aria-expanded={!isCollapsed}
          >
            <span className={`nav-folder-chevron${isCollapsed ? " nav-folder-chevron--collapsed" : ""}`} aria-hidden="true">&#9662;</span>
            <span className="nav-folder-name">{folder.name}</span>
          </button>
          <span className="nav-row-menu">
            <FolderMenu folder={folder} allFolders={folders} />
          </span>
        </div>
        {!isCollapsed && (
          <div className="nav-folder-children">
            {kids.map((k) => renderFolder(k, depth + 1))}
            {folderPages.map((p) => (
              <PageLink key={p.slug} page={p} folders={folders} active={activeSlug === p.slug} pinned={pinnedSet.has(p.slug)} />
            ))}
          </div>
        )}
      </div>
    );
  }

  const rootFolders = childFolders.get(null) ?? [];
  const unfiled = pagesByFolder.get(null) ?? [];

  if (hidden) {
    return (
      <button
        className="nav-reveal"
        onClick={toggleHidden}
        aria-label="Show navigation"
        title="Show navigation (⌘\)"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="9" y1="3" x2="9" y2="21" />
        </svg>
      </button>
    );
  }

  return (
    <aside className="app-sidebar" aria-label="Workspace navigation" ref={sidebarRef}>
      <div
        className={`sidebar-resize-handle${resizing ? " sidebar-resize-handle--active" : ""}`}
        onMouseDown={onResizeStart}
      />
      <div className="nav-org">
        <Link href="/dashboard" className="nav-org-name" title={orgName}>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- arbitrary external/user URL, next/image needs domain allowlisting
            <img src={logoUrl} alt={orgName} className="nav-org-logo" />
          ) : (
            orgName
          )}
        </Link>
        <button
          className="nav-hide-btn"
          onClick={toggleHidden}
          aria-label="Hide navigation"
          title="Hide navigation (⌘\)"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="11 17 6 12 11 7" />
            <polyline points="18 17 13 12 18 7" />
          </svg>
        </button>
      </div>

      <button
        className="nav-search"
        onClick={() => window.dispatchEvent(new CustomEvent("curata-open-palette"))}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        Search
        <kbd className="nav-search-kbd">&#8984;K</kbd>
      </button>

      <nav className="nav-links" aria-label="Main">
        <Link href="/dashboard" className={`nav-link-item${pathname === "/dashboard" ? " nav-link-item--active" : ""}`}>
          Home
        </Link>
        <NewPageButton className="nav-link-item nav-link-item--action" label="+ New page" />
        <NewFolderButton className="nav-link-item nav-link-item--action" label="+ New folder" />
        {cleanupCount > 0 && (
          <Link href="/cleanup" className={`nav-link-item${pathname === "/cleanup" ? " nav-link-item--active" : ""}`}>
            Cleanup
            <span className="nav-count-badge">{cleanupCount}</span>
          </Link>
        )}
      </nav>

      {(pinned.length > 0 || recentList.length > 0) && (
        <div className="nav-section">
          {pinned.length > 0 && (
            <>
              <div className="nav-section-label">Pinned</div>
              {pinned.map((p) => (
                <PageLink key={p.slug} page={p} folders={folders} active={activeSlug === p.slug} pinned />
              ))}
            </>
          )}
          {recentList.length > 0 && (
            <>
              <div className="nav-section-label">Recent</div>
              {recentList.map((r) => {
                const page = pages.find((p) => p.slug === r.slug);
                if (!page) return null;
                return <PageLink key={r.slug} page={page} folders={folders} active={activeSlug === r.slug} pinned={pinnedSet.has(r.slug)} />;
              })}
            </>
          )}
        </div>
      )}

      <div className="nav-section nav-tree">
        <div
          className={`nav-section-label${dropTarget === "__root" ? " nav-section-label--dragover" : ""}`}
          {...dropProps(null)}
        >
          Workspace
          {expanded.size > 0 && (
            <button
              className="nav-collapse-all"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(new Set());
                localStorage.setItem(EXPAND_KEY, "[]");
              }}
              title="Collapse all folders"
            >
              &#9652;&#9662;
            </button>
          )}
        </div>
        {rootFolders.map((f) => renderFolder(f, 0))}
        {unfiled.map((p) => (
          <PageLink key={p.slug} page={p} folders={folders} active={activeSlug === p.slug} pinned={pinnedSet.has(p.slug)} />
        ))}
        {archivedPages.length > 0 && (
          <div className="nav-folder" style={{ "--nav-depth": 0 } as React.CSSProperties}>
            <div className="nav-folder-row">
              <button
                className="nav-folder-toggle nav-folder-toggle--archived"
                onClick={() => toggle("__archived")}
                aria-expanded={expanded.has("__archived")}
              >
                <span className={`nav-folder-chevron${!expanded.has("__archived") ? " nav-folder-chevron--collapsed" : ""}`} aria-hidden="true">&#9662;</span>
                <span className="nav-folder-name">Archived</span>
                <span className="nav-count-badge">{archivedPages.length}</span>
              </button>
            </div>
            {expanded.has("__archived") && (
              <div className="nav-folder-children">
                {archivedPages.map((p) => (
                  <PageLink key={p.slug} page={p} folders={folders} active={activeSlug === p.slug} pinned={false} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="nav-footer">
        {authControls && <div className="nav-auth">{authControls}</div>}
        <Link href="/settings" className={`nav-link-item${pathname === "/settings" ? " nav-link-item--active" : ""}`}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          Settings
        </Link>
      </div>
    </aside>
  );
}
