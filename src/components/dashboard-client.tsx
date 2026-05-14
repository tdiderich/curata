"use client";

import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
  parentId: string | null;
  pageCount: number;
  childFolderCount: number;
}

type SortKey = "lastActivity" | "title" | "views";

function useSortKey(): [SortKey, (k: SortKey) => void] {
  const [key, setKey] = useState<SortKey>("lastActivity");
  useEffect(() => {
    const stored = localStorage.getItem("curata-sort") as SortKey | null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
      <NewFolderButton />
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
        </div>
      )}
    </div>
  );
}


function EmptyWelcome({ orgName }: { orgName?: string }) {
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
      <div className="empty-welcome-heading">Welcome to {orgName ?? "curata"}</div>
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
  orgName?: string;
}

function PageRow({ page, folders, indent = 1 }: { page: SerializedPageMeta; folders: FolderRow[]; indent?: number }) {
  return (
    <tr className={`dash-row dash-row--nested${indent > 1 ? " dash-row--deep" : ""}`}>
      <td className="dash-td dash-td-title" style={indent > 1 ? { paddingLeft: `${indent * 1.5}rem` } : undefined}>
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
  );
}

function FolderContentsLabel({ folder }: { folder: FolderRow }) {
  const parts: string[] = [];
  if (folder.pageCount > 0) parts.push(`${folder.pageCount} page${folder.pageCount !== 1 ? "s" : ""}`);
  if (folder.childFolderCount > 0) parts.push(`${folder.childFolderCount} folder${folder.childFolderCount !== 1 ? "s" : ""}`);
  return <span className="dash-folder-count">{parts.join(", ") || "empty"}</span>;
}

export function DashboardClient({ pages, folders, pageCount, orgName }: DashboardClientProps) {
  const [view, setView] = useDashView();
  const [sortKey, setSortKey] = useSortKey();
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(
    () => new Set(["__unfiled", ...folders.map((f) => f.id)])
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [rootFolderId, setRootFolderId] = useState<string | null>(null);

  const sorted = useMemo(() => sortPages(pages, sortKey), [pages, sortKey]);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return sorted;
    const q = searchQuery.toLowerCase();
    return sorted.filter((p) => {
      if (p.title.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q)) return true;
      if (p.folderId) {
        let f = folders.find((x) => x.id === p.folderId);
        while (f) {
          if (f.name.toLowerCase().includes(q)) return true;
          f = f.parentId ? folders.find((x) => x.id === f!.parentId) : undefined;
        }
      }
      return false;
    });
  }, [sorted, searchQuery, folders]);

  const folderMap = useMemo(() => {
    const m = new Map<string, FolderRow>();
    for (const f of folders) m.set(f.id, f);
    return m;
  }, [folders]);

  const topFolders = useMemo(
    () => folders.filter((f) => (rootFolderId ? f.parentId === rootFolderId : !f.parentId)),
    [folders, rootFolderId]
  );
  const childFoldersByParent = useMemo(() => {
    const map = new Map<string, FolderRow[]>();
    for (const f of folders) {
      if (f.parentId) {
        const list = map.get(f.parentId) || [];
        list.push(f);
        map.set(f.parentId, list);
      }
    }
    return map;
  }, [folders]);

  const rootBreadcrumb = useMemo(() => {
    const crumbs: { id: string | null; name: string }[] = [];
    let current = rootFolderId ? folderMap.get(rootFolderId) : null;
    while (current) {
      crumbs.unshift({ id: current.id, name: current.name });
      current = current.parentId ? folderMap.get(current.parentId) : undefined;
    }
    crumbs.unshift({ id: null, name: "All" });
    return crumbs;
  }, [rootFolderId, folderMap]);

  const folderIdsWithMatches = useMemo(() => {
    const ids = new Set<string>();
    for (const p of filtered) {
      if (p.folderId) {
        let current: FolderRow | undefined = folderMap.get(p.folderId);
        while (current) {
          ids.add(current.id);
          current = current.parentId ? folderMap.get(current.parentId) : undefined;
        }
      }
    }
    return ids;
  }, [filtered, folderMap]);

  const effectiveCollapsed = useMemo(() => {
    if (!searchQuery.trim()) return collapsedFolders;
    const next = new Set(collapsedFolders);
    for (const id of folderIdsWithMatches) next.delete(id);
    if (filtered.some((p) => !p.folderId)) next.delete("__unfiled");
    return next;
  }, [collapsedFolders, searchQuery, folderIdsWithMatches, filtered]);

  const toggleFolderCollapse = useCallback((folderId: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }, []);

  if (pageCount === 0) {
    return (
      <div className="dash-root">
        <EmptyWelcome orgName={orgName} />
      </div>
    );
  }

  const unfiledPages = rootFolderId
    ? filtered.filter((p) => p.folderId === rootFolderId)
    : filtered.filter((p) => p.folderId === null);

  const sortLabel = sortKey === "title" ? "Title" : sortKey === "views" ? "Views" : "Updated";

  return (
    <div className="dash-root">
      {rootFolderId && (
        <div className="dash-breadcrumb">
          {rootBreadcrumb.map((crumb, i) => (
            <React.Fragment key={crumb.id ?? "__all"}>
              {i > 0 && <span className="dash-breadcrumb-sep">/</span>}
              {i < rootBreadcrumb.length - 1 ? (
                <button className="dash-breadcrumb-link" onClick={() => setRootFolderId(crumb.id)}>
                  {crumb.name}
                </button>
              ) : (
                <span className="dash-breadcrumb-current">{crumb.name}</span>
              )}
            </React.Fragment>
          ))}
        </div>
      )}
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
      ) : searchQuery.trim() ? (
        <table className="dash-table">
          <thead>
            <tr>
              <th className="dash-th dash-th-title">Title</th>
              <th className="dash-th">Folder</th>
              <th className="dash-th">{sortLabel}</th>
              <th className="dash-th dash-th-right">Views</th>
              <th className="dash-th dash-th-right">Annotations</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((page) => {
              const f = page.folderId ? folderMap.get(page.folderId) : null;
              return (
                <tr key={page.slug} className="dash-row">
                  <td className="dash-td dash-td-title">
                    <Link href={`/pages/${page.slug}`} className="dash-page-link">
                      {page.title}
                    </Link>
                  </td>
                  <td className="dash-td dash-td-muted">{f ? f.name : <span className="dash-none">&mdash;</span>}</td>
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
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={5} className="dash-td dash-td-muted" style={{ textAlign: "center", padding: "24px" }}>No pages match &ldquo;{searchQuery}&rdquo;</td></tr>
            )}
          </tbody>
        </table>
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
            const isCollapsed = effectiveCollapsed.has("__unfiled");
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
                  <PageRow key={page.slug} page={page} folders={folders} />
                ))}
              </tbody>
            );
          })()}
          {topFolders.map((folder) => {
            const directPages = filtered.filter((p) => p.folderId === folder.id);
            const children = childFoldersByParent.get(folder.id) || [];
            const isCollapsed = effectiveCollapsed.has(folder.id);
            return (
              <tbody key={folder.id}>
                <tr
                  className={`dash-folder-row${isCollapsed ? " dash-folder-row--collapsed" : ""}`}
                  onClick={() => toggleFolderCollapse(folder.id)}
                  onDoubleClick={() => { if (folder.childFolderCount > 0) setRootFolderId(folder.id); }}
                >
                  <td colSpan={5} className="dash-folder-td">
                    <div className="dash-folder-row-inner">
                      <span className="dash-folder-chevron">&#9660;</span>
                      <span className="dash-folder-name">{folder.name}</span>
                      <FolderContentsLabel folder={folder} />
                      <span className="dash-folder-menu" onClick={(e) => e.stopPropagation()}>
                        <FolderMenu folder={folder} allFolders={folders} />
                      </span>
                    </div>
                  </td>
                </tr>
                {!isCollapsed && (
                  <>
                    {children.map((child) => {
                      const drillable = child.childFolderCount > 0;
                      const childCollapsed = drillable || effectiveCollapsed.has(child.id);
                      const childPages = filtered.filter((p) => p.folderId === child.id);
                      return (
                        <React.Fragment key={child.id}>
                          <tr
                            className={`dash-folder-row dash-folder-row--child${drillable ? " dash-folder-row--drillable" : ""}${childCollapsed ? " dash-folder-row--collapsed" : ""}`}
                            onClick={() => { if (drillable) setRootFolderId(child.id); else toggleFolderCollapse(child.id); }}
                          >
                            <td colSpan={5} className="dash-folder-td">
                              <div className="dash-folder-row-inner dash-folder-row-inner--child">
                                {!drillable && <span className="dash-folder-chevron">&#9660;</span>}
                                <span className="dash-folder-name">{child.name}</span>
                                <FolderContentsLabel folder={child} />
                                {drillable && <span className="dash-folder-drill-hint">&#8250;</span>}
                                <span className="dash-folder-menu" onClick={(e) => e.stopPropagation()}>
                                  <FolderMenu folder={child} allFolders={folders} />
                                </span>
                              </div>
                            </td>
                          </tr>
                          {!childCollapsed && childPages.map((page) => (
                            <PageRow key={page.slug} page={page} folders={folders} indent={2} />
                          ))}
                        </React.Fragment>
                      );
                    })}
                    {directPages.map((page) => (
                      <PageRow key={page.slug} page={page} folders={folders} />
                    ))}
                  </>
                )}
              </tbody>
            );
          })}
        </table>
      )}
    </div>
  );
}
