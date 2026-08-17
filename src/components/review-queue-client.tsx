"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { basePath } from "@/lib/api-fetch";
import { toast } from "@/components/toast";

export interface ReviewQueueRowSerialized {
  slug: string;
  title: string;
  folderId: string | null;
  folderName: string | null;
  latestEditedBy: string;
  latestUpdatedAt: string;
  neverTrusted: boolean;
  versionsBehind: number;
  sinceUnapprovedAt: string;
  concepts: string[];
  createdByMe: boolean;
  annotatedByMe: boolean;
  /** False when an approval rule governs this page and the viewer isn't in it. */
  eligible: boolean;
  /** Set whenever an approval rule governs this page, shown when ineligible. */
  approversNote: string | null;
}

interface VersionRow {
  id: string;
  contentHash: string;
  createdBy: string;
  createdAt: string;
  yamlContent: string;
}

function relativeTime(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diffDay = Math.floor((now - d.getTime()) / 86400000);
  if (diffDay <= 0) return "today";
  if (diffDay === 1) return "1 day ago";
  if (diffDay < 30) return `${diffDay} days ago`;
  const months = Math.floor(diffDay / 30);
  if (months < 12) return `${months} month${months !== 1 ? "s" : ""} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years !== 1 ? "s" : ""} ago`;
}

function DiffPanel({ slug, onClose }: { slug: string; onClose: () => void }) {
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [trustedVersionId, setTrustedVersionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`${basePath}/api/versions?slug=${encodeURIComponent(slug)}`);
        if (res.ok && !cancelled) {
          const data = (await res.json()) as { versions: VersionRow[]; trustedVersionId: string | null };
          setVersions(data.versions);
          setTrustedVersionId(data.trustedVersionId);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [slug]);

  const latest = versions?.[0] ?? null;
  const trusted = versions?.find((v) => v.id === trustedVersionId) ?? null;

  return (
    <div className="cleanup-preview">
      <div className="cleanup-preview-bar">
        <span>{slug} &mdash; trusted vs. latest</span>
        <Link href={`/pages/${slug}`} className="cleanup-link">open</Link>
        <button className="cleanup-preview-close" onClick={onClose} aria-label="Close diff">&times;</button>
      </div>
      {loading && <div className="vh-empty">Loading&hellip;</div>}
      {!loading && (
        <div className="rq-diff-body">
          <div className="rq-diff-col">
            <div className="rq-diff-col-label">Trusted{trusted ? "" : " (none yet)"}</div>
            <pre className="vh-preview-yaml">{trusted?.yamlContent ?? "No trusted version — this page has never been approved."}</pre>
          </div>
          <div className="rq-diff-col">
            <div className="rq-diff-col-label">Latest</div>
            <pre className="vh-preview-yaml">{latest?.yamlContent ?? ""}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

type FolderFilter = string | "all";

interface ReviewQueueClientProps {
  rows: ReviewQueueRowSerialized[];
  canTrust: boolean;
}

export function ReviewQueueClient({ rows, canTrust }: ReviewQueueClientProps) {
  const router = useRouter();
  const [folderFilter, setFolderFilter] = useState<FolderFilter>("all");
  const [conceptFilter, setConceptFilter] = useState<string>("all");
  const [createdByMe, setCreatedByMe] = useState(false);
  const [annotatedByMe, setAnnotatedByMe] = useState(false);
  const [diffSlug, setDiffSlug] = useState<string | null>(null);
  const [busySlug, setBusySlug] = useState<string | null>(null);

  const folders = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) {
      if (r.folderId && r.folderName) map.set(r.folderId, r.folderName);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const concepts = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) for (const c of r.concepts) set.add(c);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (folderFilter !== "all" && r.folderId !== folderFilter) return false;
      if (conceptFilter !== "all" && !r.concepts.includes(conceptFilter)) return false;
      if (createdByMe && !r.createdByMe) return false;
      if (annotatedByMe && !r.annotatedByMe) return false;
      return true;
    });
  }, [rows, folderFilter, conceptFilter, createdByMe, annotatedByMe]);

  async function trustLatest(slug: string) {
    setBusySlug(slug);
    try {
      const versionsRes = await fetch(`${basePath}/api/versions?slug=${encodeURIComponent(slug)}`);
      if (!versionsRes.ok) {
        toast.error("Couldn't load versions — check your connection and try again.");
        return;
      }
      const data = (await versionsRes.json()) as { versions: Array<{ id: string }> };
      const latestId = data.versions[0]?.id;
      if (!latestId) return;
      const res = await fetch(`${basePath}/api/versions/trust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, versionId: latestId }),
      });
      if (res.ok) {
        toast.success(`Trusted the latest version of "${slug}"`);
        if (diffSlug === slug) setDiffSlug(null);
        router.refresh();
      } else {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(`Couldn't trust latest: ${err.error ?? "unknown error"}`);
      }
    } catch {
      toast.error("Couldn't trust latest — check your connection and try again.");
    } finally {
      setBusySlug(null);
    }
  }

  return (
    <div className="dash-root">
      <div className="cleanup-header">
        <h1 className="cleanup-heading">Review queue</h1>
        <span className="cleanup-count">{rows.length} page{rows.length !== 1 ? "s" : ""} awaiting review</span>
      </div>

      <div className="rq-filters">
        <select
          className="dash-page-folder-select"
          value={folderFilter}
          onChange={(e) => setFolderFilter(e.target.value)}
          aria-label="Filter by folder"
        >
          <option value="all">All folders</option>
          {folders.map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
        <select
          className="dash-page-folder-select"
          value={conceptFilter}
          onChange={(e) => setConceptFilter(e.target.value)}
          aria-label="Filter by concept or tag"
        >
          <option value="all">All concepts</option>
          {concepts.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <button
          className={`btn btn--ghost${createdByMe ? " cleanup-btn--active" : ""}`}
          onClick={() => setCreatedByMe((v) => !v)}
          aria-pressed={createdByMe}
        >
          Created by me
        </button>
        <button
          className={`btn btn--ghost${annotatedByMe ? " cleanup-btn--active" : ""}`}
          onClick={() => setAnnotatedByMe((v) => !v)}
          aria-pressed={annotatedByMe}
        >
          Annotated by me
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="cleanup-empty">
          <div className="cleanup-empty-title">Queue is clear</div>
          <div className="cleanup-empty-sub">
            Every page is either trusted and up to date, or hasn&apos;t needed review yet.
            Mark a version trusted from a page&apos;s version history to start tracking it here.
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="cleanup-empty">
          <div className="cleanup-empty-title">No pages match these filters</div>
          <div className="cleanup-empty-sub">Clear a filter to see the rest of the queue.</div>
        </div>
      ) : (
        <div className="cleanup-body">
          <div className="cleanup-list">
            {filtered.map((r) => (
              <div key={r.slug} className={`cleanup-row${diffSlug === r.slug ? " cleanup-row--previewing" : ""}`}>
                <button className="cleanup-row-main" onClick={() => setDiffSlug(diffSlug === r.slug ? null : r.slug)}>
                  <div className="cleanup-row-top">
                    <span className="cleanup-title">{r.title}</span>
                    {r.folderName && <span className="cleanup-folder">{r.folderName}</span>}
                    <span className={`pill vh-list-badge${r.neverTrusted ? "" : " vh-list-badge--trusted"}`}>
                      {r.neverTrusted ? "never trusted" : `${r.versionsBehind} version${r.versionsBehind !== 1 ? "s" : ""} behind`}
                    </span>
                  </div>
                  <div className="cleanup-meta">
                    last edited by {r.latestEditedBy} &middot; {relativeTime(r.latestUpdatedAt)} &middot;
                    {" "}waiting since {relativeTime(r.sinceUnapprovedAt)}
                  </div>
                </button>
                <div className="cleanup-actions">
                  <button className="btn btn--ghost" onClick={() => setDiffSlug(diffSlug === r.slug ? null : r.slug)}>
                    {diffSlug === r.slug ? "Hide diff" : "View diff"}
                  </button>
                  {canTrust && (
                    r.eligible ? (
                      <button
                        className="btn cleanup-btn--archive"
                        disabled={busySlug === r.slug}
                        onClick={() => trustLatest(r.slug)}
                      >
                        {busySlug === r.slug ? "Trusting…" : "Trust latest"}
                      </button>
                    ) : (
                      r.approversNote && <span className="rq-approvers-note">{r.approversNote}</span>
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
          {diffSlug && <DiffPanel slug={diffSlug} onClose={() => setDiffSlug(null)} />}
        </div>
      )}
    </div>
  );
}
