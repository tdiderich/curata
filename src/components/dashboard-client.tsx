"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PageMenu } from "@/components/folder-actions";
import { readPinsSeeded, PINS_CHANGED_EVENT } from "@/lib/pins";
import { DashboardFeed } from "@/components/dashboard-feed";
import { toast } from "@/components/toast";
import { TEMPLATES, PERSONAS } from "@/lib/templates";

export interface SerializedPageMeta {
  slug: string;
  title: string;
  annotationCount: number;
  pendingAnnotationCount: number;
  viewCount: number;
  updatedAt: string;
  lastActivity: string;
  lastEditedBy: string;
  folderId: string | null;
  visibility: string;
  snippet: string;
  createdBy: string;
  sortOrder: number | null;
  pinned: boolean;
  freshness: "fresh" | "due" | "overdue" | null;
}

interface FolderRow {
  id: string;
  name: string;
  visibility: string;
  parentId: string | null;
  pageCount: number;
  childFolderCount: number;
}

type SortKey = "sortOrder" | "lastActivity" | "title" | "views";

const VALID_SORT_KEYS: SortKey[] = ["sortOrder", "lastActivity", "title", "views"];

function useSortKey(): [SortKey, (k: SortKey) => void] {
  const [key, setKey] = useState<SortKey>("title");
  useEffect(() => {
    const stored = localStorage.getItem("curata-sort") as SortKey | null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored && VALID_SORT_KEYS.includes(stored)) setKey(stored);
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
    case "sortOrder":
      sorted.sort((a, b) => {
        const aNull = a.sortOrder === null || a.sortOrder === undefined;
        const bNull = b.sortOrder === null || b.sortOrder === undefined;
        if (aNull && bNull) return a.title.localeCompare(b.title);
        if (aNull) return 1;
        if (bNull) return -1;
        return a.sortOrder! - b.sortOrder!;
      });
      break;
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

// Clickable table header: sets the sort key, shows an arrow on the active one.
function SortTh({
  label,
  k,
  sortKey,
  onSort,
  className,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  onSort: (k: SortKey) => void;
  className?: string;
}) {
  const active = sortKey === k;
  return (
    <th className={className} aria-sort={active ? "ascending" : undefined}>
      <button className={`dash-th-sort${active ? " dash-th-sort--active" : ""}`} onClick={() => onSort(k)}>
        {label}
        {active && <span aria-hidden="true"> &darr;</span>}
      </button>
    </th>
  );
}

function EmptyWelcome({ orgName }: { orgName?: string }) {
  const router = useRouter();
  const [creating, setCreating] = useState<string | null>(null);

  async function createFromTemplate(slug: string, title: string) {
    setCreating(slug);
    try {
      const res = await fetch("/api/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, templateSlug: slug }),
      });
      const data = await res.json();
      if (res.ok) {
        router.push(`/pages/${data.slug}`);
      } else {
        toast.error(`Couldn't create page: ${data.error ?? "unknown error"}`);
        setCreating(null);
      }
    } catch {
      toast.error("Couldn't create page — check your connection and try again.");
      setCreating(null);
    }
  }

  async function createBlank() {
    setCreating("__blank");
    try {
      const res = await fetch("/api/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Untitled", shell: "standard" }),
      });
      const data = await res.json();
      if (res.ok) {
        router.push(`/pages/${data.slug}?edit=1`);
      } else {
        toast.error(`Couldn't create page: ${data.error ?? "unknown error"}`);
        setCreating(null);
      }
    } catch {
      toast.error("Couldn't create page — check your connection and try again.");
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

type AttentionFilter = "annotations" | "updated" | "stale" | null;

interface DashboardClientProps {
  pages: SerializedPageMeta[];
  folders: FolderRow[];
  pageCount: number;
  orgName?: string;
  allowPublic?: boolean;
  cleanupCount?: number;
}

// The dashboard is a landing surface: what needs attention, then recent
// activity. The folder tree lives in the app sidebar; the table view here is
// a flat, sortable index of everything.
export function DashboardClient({ pages, folders, pageCount, orgName, allowPublic = true, cleanupCount = 0 }: DashboardClientProps) {
  const [sortKey, setSortKey] = useSortKey();
  const [searchQuery, setSearchQuery] = useState("");
  const [lastVisit, setLastVisit] = useState<number | null>(null);
  const [attentionFilter, setAttentionFilter] = useState<AttentionFilter>(null);

  // The previous visit timestamp drives "new since you were here" badges for
  // this session; the marker is then advanced for the next session.
  useEffect(() => {
    const prev = localStorage.getItem("curata-last-visit");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLastVisit(prev ? parseInt(prev, 10) : null);
    localStorage.setItem("curata-last-visit", String(Date.now()));
  }, []);

  // Per-user pins drive the star badges; org-wide Page.pinned only seeds them.
  const [pins, setPins] = useState<string[]>([]);
  useEffect(() => {
    const sync = () => setPins(readPinsSeeded(pages.filter((p) => p.pinned).map((p) => p.slug)));
    sync();
    window.addEventListener(PINS_CHANGED_EVENT, sync);
    return () => window.removeEventListener(PINS_CHANGED_EVENT, sync);
  }, [pages]);
  const pinnedSet = useMemo(() => new Set(pins), [pins]);

  const pendingAnnPages = useMemo(
    () => pages.filter((p) => p.pendingAnnotationCount > 0),
    [pages]
  );
  const pendingAnnTotal = useMemo(
    () => pendingAnnPages.reduce((n, p) => n + p.pendingAnnotationCount, 0),
    [pendingAnnPages]
  );
  const updatedPages = useMemo(
    () =>
      lastVisit === null
        ? []
        : pages.filter((p) => new Date(p.lastActivity).getTime() > lastVisit),
    [pages, lastVisit]
  );
  const stalePages = useMemo(
    () => pages.filter((p) => p.freshness === "overdue" || p.freshness === "due"),
    [pages]
  );

  const toggleAttention = useCallback((f: AttentionFilter) => {
    setAttentionFilter((cur) => (cur === f ? null : f));
  }, []);

  const folderMap = useMemo(() => {
    const m = new Map<string, FolderRow>();
    for (const f of folders) m.set(f.id, f);
    return m;
  }, [folders]);

  const sorted = useMemo(() => sortPages(pages, sortKey), [pages, sortKey]);

  const filtered = useMemo(() => {
    let pool = sorted;
    if (attentionFilter === "annotations") {
      pool = pool.filter((p) => p.pendingAnnotationCount > 0);
    } else if (attentionFilter === "updated" && lastVisit !== null) {
      pool = pool.filter((p) => new Date(p.lastActivity).getTime() > lastVisit);
    } else if (attentionFilter === "stale") {
      pool = pool.filter((p) => p.freshness === "overdue" || p.freshness === "due");
    }
    if (!searchQuery.trim()) return pool;
    const q = searchQuery.toLowerCase();
    return pool.filter((p) => {
      if (p.title.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q)) return true;
      if (p.folderId) {
        let f = folderMap.get(p.folderId);
        while (f) {
          if (f.name.toLowerCase().includes(q)) return true;
          f = f.parentId ? folderMap.get(f.parentId) : undefined;
        }
      }
      return false;
    });
  }, [sorted, searchQuery, folderMap, attentionFilter, lastVisit]);

  if (pageCount === 0) {
    return (
      <div className="dash-root">
        <EmptyWelcome orgName={orgName} />
      </div>
    );
  }

  // Feed by default; filtering or chip selection pivots to the flat table.
  const showTable = Boolean(searchQuery.trim()) || attentionFilter !== null;

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
      </div>

      {(pendingAnnPages.length > 0 || updatedPages.length > 0 || stalePages.length > 0 || cleanupCount > 0) && (
        <div className="dash-attention" aria-label="Needs attention">
          {cleanupCount > 0 && (
            <Link href="/cleanup" className="dash-attention-chip dash-attention-chip--cleanup">
              <span className="dash-attention-num">{cleanupCount}</span>
              page{cleanupCount !== 1 ? "s" : ""} queued for removal &rarr;
            </Link>
          )}
          {pendingAnnPages.length > 0 && (
            <button
              className={`dash-attention-chip${attentionFilter === "annotations" ? " dash-attention-chip--active" : ""}`}
              onClick={() => toggleAttention("annotations")}
            >
              <span className="dash-attention-num">{pendingAnnTotal}</span>
              annotation{pendingAnnTotal !== 1 ? "s" : ""} to review
            </button>
          )}
          {updatedPages.length > 0 && (
            <button
              className={`dash-attention-chip${attentionFilter === "updated" ? " dash-attention-chip--active" : ""}`}
              onClick={() => toggleAttention("updated")}
            >
              <span className="dash-attention-num">{updatedPages.length}</span>
              updated since your last visit
            </button>
          )}
          {stalePages.length > 0 && (
            <button
              className={`dash-attention-chip${attentionFilter === "stale" ? " dash-attention-chip--active" : ""}`}
              onClick={() => toggleAttention("stale")}
            >
              <span className="dash-attention-num">{stalePages.length}</span>
              due for review
            </button>
          )}
        </div>
      )}

      {showTable ? (
        <table className="dash-table">
          <thead>
            <tr>
              <SortTh label="Title" k="title" sortKey={sortKey} onSort={setSortKey} className="dash-th dash-th-title" />
              <th className="dash-th">Folder</th>
              <SortTh label="Updated" k="lastActivity" sortKey={sortKey} onSort={setSortKey} className="dash-th" />
              <SortTh label="Views" k="views" sortKey={sortKey} onSort={setSortKey} className="dash-th dash-th-right" />
              <th className="dash-th dash-th-right">Annotations</th>
              <th className="dash-th dash-th-actions"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((page) => {
              const f = page.folderId ? folderMap.get(page.folderId) : null;
              const updatedSinceVisit =
                lastVisit !== null && new Date(page.lastActivity).getTime() > lastVisit;
              return (
                <tr key={page.slug} className="dash-row">
                  <td className="dash-td dash-td-title">
                    <Link href={`/pages/${page.slug}`} className="dash-page-link">
                      {page.title}
                    </Link>
                    {pinnedSet.has(page.slug) && (
                      <span className="dash-badge dash-badge--pin" title="Pinned">&#9733;</span>
                    )}
                    {updatedSinceVisit && (
                      <span className="dash-badge dash-badge--updated" title={`Updated by ${page.lastEditedBy} since your last visit`}>
                        new
                      </span>
                    )}
                    {page.freshness === "overdue" && (
                      <span className="dash-badge dash-badge--stale" title="Past its review cadence">stale</span>
                    )}
                    {page.freshness === "due" && (
                      <span className="dash-badge dash-badge--due" title="Approaching its review cadence">review due</span>
                    )}
                  </td>
                  <td className="dash-td dash-td-muted">{f ? f.name : <span className="dash-none">&mdash;</span>}</td>
                  <td className="dash-td dash-td-muted">{formatDate(page.lastActivity)}</td>
                  <td className="dash-td dash-td-right dash-td-muted">
                    {page.viewCount > 0 ? page.viewCount : <span className="dash-none">&mdash;</span>}
                  </td>
                  <td className="dash-td dash-td-right">
                    {page.pendingAnnotationCount > 0 ? (
                      <span className="dash-ann-count dash-ann-count--pending" title={`${page.pendingAnnotationCount} awaiting review`}>
                        {page.pendingAnnotationCount}
                      </span>
                    ) : page.annotationCount > 0 ? (
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
                      allowPublic={allowPublic}
                    />
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="dash-td dash-td-muted" style={{ textAlign: "center", padding: "24px" }}>No pages match</td></tr>
            )}
          </tbody>
        </table>
      ) : (
        <div className="dash-workspace">
          <DashboardFeed pages={filtered} />
        </div>
      )}
    </div>
  );
}
