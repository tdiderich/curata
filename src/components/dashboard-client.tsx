"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageFolderSelect, VisibilityBadge } from "@/components/page-folder-select";
import { DeletePageButton } from "@/components/delete-page-button";
import { NewFolderButton, FolderMenu } from "@/components/folder-actions";
import { SearchBar } from "@/components/search-bar";
import { NewPageButton } from "@/components/new-page-button";
import { DashboardFeed } from "@/components/dashboard-feed";
import { useDashView } from "@/components/view-toggle";
import { TEMPLATES, PERSONAS } from "@/lib/templates";

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

function BulkBar({
  count,
  folders,
  onDelete,
  onMove,
  onVisibility,
  onClear,
}: {
  count: number;
  folders: FolderRow[];
  onDelete: () => void;
  onMove: (folderId: string | null) => void;
  onVisibility: (v: string) => void;
  onClear: () => void;
}) {
  const [moveVal, setMoveVal] = useState("");
  const [visVal, setVisVal] = useState("");

  return (
    <div className="bulk-bar">
      <span className="bulk-bar-count">
        {count} selected
      </span>
      <div className="bulk-bar-actions">
        <select
          className="bulk-bar-select"
          value={moveVal}
          onChange={(e) => {
            const v = e.target.value;
            if (v) onMove(v === "__none" ? null : v);
            setMoveVal("");
          }}
          aria-label="Move selected pages"
        >
          <option value="" disabled>Move to...</option>
          <option value="__none">No folder</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
        <select
          className="bulk-bar-select"
          value={visVal}
          onChange={(e) => {
            const v = e.target.value;
            if (v) onVisibility(v);
            setVisVal("");
          }}
          aria-label="Change visibility"
        >
          <option value="" disabled>Visibility...</option>
          <option value="personal">Private</option>
          <option value="shared">Shared</option>
          <option value="public">Public</option>
        </select>
        <button className="bulk-bar-btn bulk-bar-btn--danger" onClick={onDelete}>
          Delete
        </button>
      </div>
      <button className="bulk-bar-clear" onClick={onClear}>
        Clear
      </button>
    </div>
  );
}

function PageTable({
  pages,
  folders,
  selected,
  onToggle,
  onToggleAll,
  sortKey,
}: {
  pages: SerializedPageMeta[];
  folders: FolderRow[];
  selected: Set<string>;
  onToggle: (slug: string) => void;
  onToggleAll: (slugs: string[]) => void;
  sortKey: SortKey;
}) {
  if (pages.length === 0) {
    return (
      <div className="dash-empty">
        <div className="dash-empty-icon">&#128196;</div>
        <div className="dash-empty-title">No pages yet</div>
        <div className="dash-empty-text">Create a page or connect an agent to get started.</div>
      </div>
    );
  }

  const allSelected = pages.length > 0 && pages.every((p) => selected.has(p.slug));
  const someSlugs = pages.map((p) => p.slug);

  const sortLabel = sortKey === "title" ? "Title" : sortKey === "views" ? "Views" : "Updated";

  return (
    <table className="dash-table">
      <thead>
        <tr>
          <th className="dash-th dash-th-check">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => onToggleAll(someSlugs)}
              aria-label="Select all pages"
            />
          </th>
          <th className="dash-th dash-th-title">Title</th>
          <th className="dash-th">Visibility</th>
          <th className="dash-th">Folder</th>
          <th className="dash-th">{sortLabel}</th>
          <th className="dash-th dash-th-right">Views</th>
          <th className="dash-th dash-th-right">Annotations</th>
          <th className="dash-th dash-th-right">Actions</th>
        </tr>
      </thead>
      <tbody>
        {pages.map((page) => (
          <tr
            key={page.slug}
            className={`dash-row${selected.has(page.slug) ? " dash-row--selected" : ""}`}
          >
            <td className="dash-td dash-td-check">
              <input
                type="checkbox"
                checked={selected.has(page.slug)}
                onChange={() => onToggle(page.slug)}
                aria-label={`Select ${page.title}`}
              />
            </td>
            <td className="dash-td dash-td-title">
              <Link href={`/pages/${page.slug}`} className="dash-page-link">
                {page.title}
              </Link>
            </td>
            <td className="dash-td">
              <VisibilityBadge slug={page.slug} visibility={page.visibility} />
            </td>
            <td className="dash-td">
              <PageFolderSelect
                slug={page.slug}
                folderId={page.folderId}
                folders={folders}
              />
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
            <td className="dash-td dash-td-right">
              <DeletePageButton slug={page.slug} title={page.title} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EmptyWelcome() {
  const router = useRouter();
  const [creating, setCreating] = useState<string | null>(null);

  async function createFromTemplate(slug: string, title: string) {
    setCreating(slug);
    const res = await fetch("/api/pages", {
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
    const res = await fetch("/api/pages", {
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const sorted = useMemo(() => sortPages(pages, sortKey), [pages, sortKey]);

  const unfiledPages = sorted.filter((p) => p.folderId === null);

  const toggleSlug = useCallback((slug: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }, []);

  const toggleAll = useCallback((slugs: string[]) => {
    setSelected((prev) => {
      const allIn = slugs.every((s) => prev.has(s));
      const next = new Set(prev);
      if (allIn) {
        slugs.forEach((s) => next.delete(s));
      } else {
        slugs.forEach((s) => next.add(s));
      }
      return next;
    });
  }, []);

  async function bulkAction(action: string, extra?: Record<string, unknown>) {
    if (selected.size === 0) return;
    setBulkBusy(true);
    try {
      const res = await fetch("/api/pages/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, slugs: [...selected], ...extra }),
      });
      if (res.ok) {
        setSelected(new Set());
        router.refresh();
      }
    } finally {
      setBulkBusy(false);
    }
  }

  function handleBulkDelete() {
    if (!confirm(`Delete ${selected.size} page${selected.size !== 1 ? "s" : ""}? This cannot be undone.`)) return;
    bulkAction("delete");
  }

  if (pageCount === 0) {
    return (
      <div className="dash-root">
        <EmptyWelcome />
      </div>
    );
  }

  return (
    <div className="dash-root">
      {selected.size > 0 && (
        <BulkBar
          count={selected.size}
          folders={folders}
          onDelete={handleBulkDelete}
          onMove={(folderId) => bulkAction("move", { folderId })}
          onVisibility={(visibility) => bulkAction("visibility", { visibility })}
          onClear={() => setSelected(new Set())}
        />
      )}

      <div className="dash-toolbar">
        <SearchBar />
        <DashActions
          sortKey={sortKey}
          onSort={setSortKey}
          view={view}
          onViewChange={setView}
        />
      </div>

      {view === "feed" ? (
        <div className="dash-workspace">
          <DashboardFeed pages={sorted} />
        </div>
      ) : (
        <>
          {unfiledPages.length > 0 && (
            <div className="dash-workspace">
              <div className="dash-workspace-header">
                <span className="dash-workspace-label">Unfiled</span>
                <span className="dash-workspace-count">
                  {unfiledPages.length} page{unfiledPages.length !== 1 ? "s" : ""}
                </span>
              </div>
              <PageTable
                pages={unfiledPages}
                folders={folders}
                selected={selected}
                onToggle={toggleSlug}
                onToggleAll={toggleAll}
                sortKey={sortKey}
              />
            </div>
          )}

          {folders.map((folder) => {
            const folderPages = sorted.filter((p) => p.folderId === folder.id);
            return (
              <div key={folder.id} className="dash-workspace">
                <div className="dash-folder-header">
                  <span className="dash-folder-toggle">&#9660;</span>
                  <span className="dash-workspace-label">{folder.name}</span>
                  <span className="dash-workspace-count">
                    {folderPages.length} page{folderPages.length !== 1 ? "s" : ""}
                  </span>
                  <span
                    className={`dash-visibility-badge dash-visibility-badge--${folder.visibility}`}
                  >
                    {folder.visibility}
                  </span>
                  <FolderMenu folder={folder} />
                </div>
                <PageTable
                  pages={folderPages}
                  folders={folders}
                  selected={selected}
                  onToggle={toggleSlug}
                  onToggleAll={toggleAll}
                  sortKey={sortKey}
                />
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
