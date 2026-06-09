"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FolderMenu, PageMenu } from "@/components/folder-actions";

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

const COLLAPSE_KEY = "curata-nav-collapsed";

function readCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? "[]") as string[]);
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

function PageLink({ page, folders, active }: { page: SidebarPage; folders: SidebarFolder[]; active: boolean }) {
  return (
    <div className={`nav-page-row${active ? " nav-page-row--active" : ""}`}>
      <Link href={`/pages/${page.slug}`} className="nav-page-link" title={page.title}>
        <svg className="nav-page-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        <span className="nav-page-title">{page.title}</span>
        {page.pinned && <span className="nav-page-pin" aria-label="Pinned">&#9733;</span>}
      </Link>
      <span className="nav-row-menu">
        <PageMenu
          slug={page.slug}
          title={page.title}
          visibility={page.visibility}
          folderId={page.folderId}
          folders={folders}
          pinned={page.pinned}
        />
      </span>
    </div>
  );
}

export function Sidebar({
  folders,
  pages,
  orgName,
  logoUrl,
  cleanupCount = 0,
  authControls,
}: {
  folders: SidebarFolder[];
  pages: SidebarPage[];
  orgName: string;
  logoUrl?: string | null;
  cleanupCount?: number;
  authControls?: React.ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [recents, setRecents] = useState<RecentEntry[]>([]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCollapsed(readCollapsed());
    setRecents(readRecents());
  }, [pathname]);

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next]));
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

  const pinned = useMemo(() => pages.filter((p) => p.pinned), [pages]);
  const knownSlugs = useMemo(() => new Set(pages.map((p) => p.slug)), [pages]);
  const recentList = useMemo(
    () => recents.filter((r) => knownSlugs.has(r.slug) && !pinned.some((p) => p.slug === r.slug)).slice(0, 4),
    [recents, knownSlugs, pinned]
  );

  const activeSlug = pathname.startsWith("/pages/")
    ? decodeURIComponent(pathname.slice("/pages/".length).split("/")[0])
    : null;

  function renderFolder(folder: SidebarFolder, depth: number) {
    const isCollapsed = collapsed.has(folder.id);
    const kids = childFolders.get(folder.id) ?? [];
    const folderPages = pagesByFolder.get(folder.id) ?? [];
    return (
      <div key={folder.id} className="nav-folder" style={{ "--nav-depth": depth } as React.CSSProperties}>
        <div className="nav-folder-row">
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
              <PageLink key={p.slug} page={p} folders={folders} active={activeSlug === p.slug} />
            ))}
          </div>
        )}
      </div>
    );
  }

  const rootFolders = childFolders.get(null) ?? [];
  const unfiled = pagesByFolder.get(null) ?? [];

  return (
    <aside className="app-sidebar" aria-label="Workspace navigation">
      <div className="nav-org">
        <Link href="/dashboard" className="nav-org-name" title={orgName}>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- arbitrary external/user URL, next/image needs domain allowlisting
            <img src={logoUrl} alt={orgName} className="nav-org-logo" />
          ) : (
            orgName
          )}
        </Link>
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
        <Link href="/concepts" className={`nav-link-item${pathname === "/concepts" ? " nav-link-item--active" : ""}`}>
          Concepts
        </Link>
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
                <PageLink key={p.slug} page={p} folders={folders} active={activeSlug === p.slug} />
              ))}
            </>
          )}
          {recentList.length > 0 && (
            <>
              <div className="nav-section-label">Recent</div>
              {recentList.map((r) => {
                const page = pages.find((p) => p.slug === r.slug);
                if (!page) return null;
                return <PageLink key={r.slug} page={page} folders={folders} active={activeSlug === r.slug} />;
              })}
            </>
          )}
        </div>
      )}

      <div className="nav-section nav-tree">
        <div className="nav-section-label">Workspace</div>
        {rootFolders.map((f) => renderFolder(f, 0))}
        {unfiled.map((p) => (
          <PageLink key={p.slug} page={p} folders={folders} active={activeSlug === p.slug} />
        ))}
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
