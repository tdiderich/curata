"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { NewFolderButton, FolderMenu, PageMenu } from "@/components/folder-actions";


import { NewPageButton } from "@/components/new-page-button";
import { DashboardFeed } from "@/components/dashboard-feed";
import { useDashView } from "@/components/view-toggle";
import { TEMPLATES, PERSONAS } from "@/lib/templates";
import { basePath } from "@/lib/api-fetch";

export interface SerializedPageMeta {
  slug: string;
  title: string;
  annotationCount: number;
  viewCount: number;
  updatedAt: string;
  lastActivity: string;
  folderId: string | null;
  visibility: string;
  snippet: string;
  createdBy: string;
}

interface FolderRow {
  id: string;
  name: string;
  visibility: string;
}

type SortKey = "lastActivity" | "title" | "views";

function useSortKey(): [SortKey, (k: SortKey) => void] {
  const [key, setKey] = useState<SortKey>("lastActivity");
  useEffect(() => {
    const stored = localStorage.getItem("curata-sort") as SortKey | null;
    if (stored) setKey(stored);
  }, []);
  const set = useCallback((k: SortKey) => {
    setKey(k);
    localStorage.setItem("curata-sort", k);
  }, []);
  return [key, set];
}

function sortPages(pages: SerializedPageMeta[], key: SortKey): SerializedPageMeta[] {
  const sorted = [...pages];
  switch (key) {
    case "lastActivity":
      sorted.sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime());
      break;
    case "title":
      sorted.sort((a, b) => a.title.localeCompare(b.title));
      break;
    case "views":
      sorted.sort((a, b) => b.viewCount - a.viewCount);
      break;
  }
  return sorted;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const SORT_LABELS: Record<SortKey, string> = {
  lastActivity: "Last updated",
  title: "Title",
  views: "Most views",
};

function DashActions({
  sortKey,
  onSort,
  view,
  onViewChange,
}: {
  sortKey: SortKey;
  onSort: (k: SortKey) => void;
  view: "feed" | "table";
  onViewChange: (v: "feed" | "table") => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div className="dash-actions-wrap" ref={ref}>
      <NewPageButton />
      <button
        className="dash-actions-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-label="Dashboard actions"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="8" cy="3" r="1.5" />
          <circle cx="8" cy="8" r="1.5" />
          <circle cx="8" cy="13" r="1.5" />
        </svg>
      </button>
      {open && (
        <div className="dash-actions-menu">
          <div className="dash-actions-section-label">Sort</div>
          {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
            <button
              key={k}
              className={`dash-actions-item${sortKey === k ? " dash-actions-item--active" : ""}`}
              onClick={() => { onSort(k); }}
            >
              {SORT_LABELS[k]}
              {sortKey === k && <span className="dash-actions-check">&#10003;</span>}
            </button>
          ))}
          <div className="dash-actions-divider" />
          <div className="dash-actions-section-label">View</div>
          <button
            className={`dash-actions-item${view === "feed" ? " dash-actions-item--active" : ""}`}
            onClick={() => { onViewChange("feed"); }}
          >
            Feed
            {view === "feed" && <span className="dash-actions-check">&#10003;</span>}
          </button>
          <button
            className={`dash-actions-item${view === "table" ? " dash-actions-item--active" : ""}`}
            onClick={() => { onViewChange("table"); }}
          >
            Table
            {view === "table" && <span className="dash-actions-check">&#10003;</span>}
          </button>
          <div className="dash-actions-divider" />
          <Link href="/settings" className="dash-actions-item" onClick={() => setOpen(false)}>
            Settings
          </Link>
          <div className="dash-actions-divider" />
          <div className="dash-actions-folder-row">
            <NewFolderButton />
          </div>
        </div>
      )}
    </div>
  );
}


function EmptyWelcome() {
  const router = useRouter();
  const [creating, setCreating] = useState<string | null>(null);

  async function createFromTemplate(slug: string, title: string) {
    setCreating(slug);
    const res = await fetch(`${basePath}/api/pages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, templateSlug: slug }),
    });
    const data = await res.json();
    if (res.ok) {
      router.push(`/pages/${data.slug}`);
    } else {
      setCreating(null);
    }
  }

  async function createBlank() {
    setCreating("__blank");
    const res = await fetch(`${basePath}/api/pages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Untitled", shell: "standard" }),
    });
    const data = await res.json();
    if (res.ok) {
      router.push(`/pages/${data.slug}?edit=1`);
    } else {
      setCreating(null);
    }
  }

  return (
    <div className="empty-welcome">
      <div className="empty-welcome-heading">Welcome to curata</div>
      <div className="empty-welcome-sub">
        Pick a template to get started, or create a blank page.
      </div>

      <button
        className={`empty-scratch${creating === "__blank" ? " empty-template-card--creating" : ""}`}
        onClick={createBlank}
        disabled={creating !== null}
      >
        <span className="empty-scratch-icon">+</span>
        <span>
          <span className="empty-scratch-title">Blank page</span>
          <br />
          <span className="empty-scratch-desc">Start from scratch with an empty layout</span>
        </span>
      </button>

      <div className="empty-divider">or pick a template</div>

      <div className="empty-groups">
        {PERSONAS.map((persona) => {
          const group = TEMPLATES.filter((t) => t.persona === persona);
          return (
            <div key={persona}>
              <div className="empty-group-label">{persona}</div>
              <div className="empty-group-cards">
                {group.map((t) => (
                  <button
                    key={t.slug}
                    className={`empty-template-card${creating === t.slug ? " empty-template-card--creating" : ""}`}
                    onClick={() => createFromTemplate(t.slug, t.title)}
                    disabled={creating !== null}
                  >
                    <span className="empty-template-card-title">{t.title}</span>
                    <span className="empty-template-card-desc">{t.description}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface DashboardClientProps {
  pages: SerializedPageMeta[];
  folders: FolderRow[];
  pageCount: number;
}

export function DashboardClient({ pages, folders, pageCount }: DashboardClientProps) {
  const router = useRouter();
  const [view, setView] = useDashView();
  const [sortKey, setSortKey] = useSortKey();
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(
    () => new Set(["__unfiled", ...folders.map((f) => f.id)])
  );
  const [searchQuery, setSearchQuery] = useState("");

  if (pageCount === 0) {
    return (
      <div className="dash-root">
        <EmptyWelcome />
      </div>
    );
  }

  const sorted = useMemo(() => sortPages(pages, sortKey), [pages, sortKey]);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return sorted;
    const q = searchQuery.toLowerCase();
    return sorted.filter((p) => p.title.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q));
  }, [sorted, searchQuery]);

  const unfiledPages = filtered.filter((p) => p.folderId === null);

  const toggleFolderCollapse = useCallback((folderId: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }, []);

  const sortLabel = sortKey === "title" ? "Title" : sortKey === "views" ? "Views" : "Updated";

  return (
    <div className="dash-root">
      <div className="dash-toolbar">
        <div className="search-bar">
          <div className="search-bar-input-wrap">
            <svg className="search-bar-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10 10L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              className="search-bar-input"
              type="text"
              placeholder="Filter pages&hellip;"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setSearchQuery(""); }}
              aria-label="Filter pages"
              autoComplete="off"
            />
            {searchQuery && (
              <button className="search-bar-clear" onClick={() => setSearchQuery("")} aria-label="Clear filter">&times;</button>
            )}
          </div>
        </div>
        <DashActions
          sortKey={sortKey}
          onSort={setSortKey}
          view={view}
          onViewChange={setView}
        />
      </div>

      {view === "feed" ? (
        <div className="dash-workspace">
          <DashboardFeed pages={filtered} />
        </div>
      ) : (
        <table className="dash-table">
          <thead>
            <tr>
              <th className="dash-th dash-th-title">Title</th>
              <th className="dash-th">{sortLabel}</th>
              <th className="dash-th dash-th-right">Views</th>
              <th className="dash-th dash-th-right">Annotations</th>
              <th className="dash-th dash-th-actions"></th>
            </tr>
          </thead>
          {unfiledPages.length > 0 && (() => {
            const isCollapsed = collapsedFolders.has("__unfiled");
            return (
              <tbody>
                <tr
                  className={`dash-folder-row${isCollapsed ? " dash-folder-row--collapsed" : ""}`}
                  onClick={() => toggleFolderCollapse("__unfiled")}
                >
                  <td colSpan={5} className="dash-folder-td">
                    <div className="dash-folder-row-inner">
                      <span className="dash-folder-chevron">&#9660;</span>
                      <span className="dash-folder-name">No Folder</span>
                      <span className="dash-folder-count">
                        {unfiledPages.length} page{unfiledPages.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </td>
                </tr>
                {!isCollapsed && unfiledPages.map((page) => (
                  <tr key={page.slug} className="dash-row dash-row--nested">
                    <td className="dash-td dash-td-title">
                      <Link href={`/pages/${page.slug}`} className="dash-page-link">
                        {page.title}
                      </Link>
                    </td>
                    <td className="dash-td dash-td-muted">{formatDate(page.lastActivity)}</td>
                    <td className="dash-td dash-td-right dash-td-muted">
                      {page.viewCount > 0 ? page.viewCount : <span className="dash-none">&mdash;</span>}
                    </td>
                    <td className="dash-td dash-td-right">
                      {page.annotationCount > 0 ? (
                        <span className="dash-ann-count">{page.annotationCount}</span>
                      ) : (
                        <span className="dash-none">&mdash;</span>
                      )}
                    </td>
                    <td className="dash-td dash-td-actions">
                      <PageMenu
                        slug={page.slug}
                        title={page.title}
                        visibility={page.visibility}
                        folderId={page.folderId}
                        folders={folders}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            );
          })()}
          {folders.map((folder) => {
            const folderPages = filtered.filter((p) => p.folderId === folder.id);
            if (folderPages.length === 0 && searchQuery.trim()) return null;
            const isCollapsed = collapsedFolders.has(folder.id);
            return (
              <tbody key={folder.id}>
                <tr
                  className={`dash-folder-row${isCollapsed ? " dash-folder-row--collapsed" : ""}`}
                  onClick={() => toggleFolderCollapse(folder.id)}
                >
                  <td colSpan={5} className="dash-folder-td">
                    <div className="dash-folder-row-inner">
                      <span className="dash-folder-chevron">&#9660;</span>
                      <span className="dash-folder-name">{folder.name}</span>
                      <span className="dash-folder-count">
                        {folderPages.length} page{folderPages.length !== 1 ? "s" : ""}
                      </span>
                      <span className="dash-folder-menu" onClick={(e) => e.stopPropagation()}>
                        <FolderMenu folder={folder} />
                      </span>
                    </div>
                  </td>
                </tr>
                {!isCollapsed && folderPages.map((page) => (
                  <tr key={page.slug} className="dash-row dash-row--nested">
                    <td className="dash-td dash-td-title">
                      <Link href={`/pages/${page.slug}`} className="dash-page-link">
                        {page.title}
                      </Link>
                    </td>
                    <td className="dash-td dash-td-muted">{formatDate(page.lastActivity)}</td>
                    <td className="dash-td dash-td-right dash-td-muted">
                      {page.viewCount > 0 ? page.viewCount : <span className="dash-none">&mdash;</span>}
                    </td>
                    <td className="dash-td dash-td-right">
                      {page.annotationCount > 0 ? (
                        <span className="dash-ann-count">{page.annotationCount}</span>
                      ) : (
                        <span className="dash-none">&mdash;</span>
                      )}
                    </td>
                    <td className="dash-td dash-td-actions">
                      <PageMenu
                        slug={page.slug}
                        title={page.title}
                        visibility={page.visibility}
                        folderId={page.folderId}
                        folders={folders}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            );
          })}
        </table>
      )}
    </div>
  );
}
