"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "@/components/toast";
import { basePath } from "@/lib/api-fetch";
import { ConfirmDeleteModal } from "@/components/confirm-delete-modal";

export interface ArchivedRow {
  slug: string;
  title: string;
  folderName: string | null;
  updatedAt: string;
}

interface FlagRow {
  id: string;
  slug: string;
  title: string;
  folderName: string | null;
  pageStatus: string;
  viewCount: number;
  contentUpdatedAt: string;
  lastViewedAt: string | null;
  action: string;
  reason: string;
  evidence: string;
  supersededBy: string | null;
  confidence: string;
  flaggedBy: string;
  flaggedAt: string;
}

const AUDIT_PROMPT = `Run the curata page cleanup audit. Read the "Workflow — Page Cleanup Audit" page first, then: list_pages, cross-reference each page's content against reality (task trees vs shipped work, supersede chains, one-off reports past their moment), and file flag_page calls with evidence for anything that should be archived, deleted, or marked superseded. Check list_flags first so you don't re-file dismissed proposals.`;

function fmtDate(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

interface PendingBulkDelete {
  kind: "flag" | "archive";
  ids: string[];
  titles: string[];
}

export function CleanupClient({ initialArchived }: { initialArchived: ArchivedRow[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<"flagged" | "archived">(
    searchParams.get("tab") === "archived" ? "archived" : "flagged"
  );
  const [flags, setFlags] = useState<FlagRow[]>([]);
  const [lastSweepAt, setLastSweepAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewSlug, setPreviewSlug] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingBulkDelete | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${basePath}/api/flags`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { flags: FlagRow[]; lastSweepAt: string | null };
      setFlags(data.flags);
      setLastSweepAt(data.lastSweepAt);
    } catch {
      toast.error("Couldn't load the cleanup queue — refresh to retry.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTab(searchParams.get("tab") === "archived" ? "archived" : "flagged");
  }, [searchParams]);

  // Latest flag per page wins for display; older pending flags ride along
  // and get resolved together on archive.
  const rows = useMemo(() => {
    const seen = new Set<string>();
    return flags.filter((f) => {
      if (seen.has(f.slug)) return false;
      seen.add(f.slug);
      return true;
    });
  }, [flags]);

  // Supersede clusters: rows whose flags point at the same replacement.
  const grouped = useMemo(() => {
    const clusters = new Map<string, FlagRow[]>();
    const singles: FlagRow[] = [];
    for (const r of rows) {
      if (r.supersededBy) {
        const list = clusters.get(r.supersededBy) ?? [];
        list.push(r);
        clusters.set(r.supersededBy, list);
      } else {
        singles.push(r);
      }
    }
    return { clusters: [...clusters.entries()].filter(([, l]) => l.length > 0), singles };
  }, [rows]);

  async function disposition(flagIds: string[], d: "archive" | "delete" | "keep" | "snooze") {
    if (d === "delete") {
      const titles = rows.filter((r) => flagIds.includes(r.id)).map((r) => r.title);
      setPendingDelete({ kind: "flag", ids: flagIds, titles });
      return;
    }
    await runDisposition(flagIds, d);
  }

  async function runDisposition(flagIds: string[], d: "archive" | "delete" | "keep" | "snooze") {
    setBusy(true);
    let ok = 0;
    let failed = 0;
    for (const id of flagIds) {
      try {
        const res = await fetch(`${basePath}/api/flags`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ flagId: id, disposition: d }),
        });
        if (res.ok) ok++;
        else failed++;
      } catch {
        failed++;
      }
    }
    setBusy(false);
    setPreviewSlug(null);
    if (ok > 0) {
      const verb = d === "keep" ? "kept" : d === "snooze" ? "snoozed" : `${d}d`;
      toast.success(`${ok} page${ok !== 1 ? "s" : ""} ${verb}`);
    }
    if (failed > 0) toast.error(`${failed} disposition${failed !== 1 ? "s" : ""} failed — retry from the queue.`);
    await load();
    router.refresh();
  }

  function selectTab(t: "flagged" | "archived") {
    setTab(t);
    router.replace(`/cleanup${t === "archived" ? "?tab=archived" : ""}`, { scroll: false });
  }

  async function archiveAction(slugs: string[], action: "delete" | "restore") {
    if (action === "delete") {
      const titles = initialArchived.filter((p) => slugs.includes(p.slug)).map((p) => p.title);
      setPendingDelete({ kind: "archive", ids: slugs, titles });
      return;
    }
    await runArchiveAction(slugs, action);
  }

  async function runArchiveAction(slugs: string[], action: "delete" | "restore") {
    setArchiveBusy(true);
    try {
      const res = await fetch(`${basePath}/api/pages/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, slugs }),
      });
      const data = (await res.json().catch(() => ({}))) as { affected?: number; error?: string };
      if (!res.ok) {
        toast.error(`Couldn't ${action} pages: ${data.error ?? "unknown error"}`);
      } else {
        toast.success(`${data.affected ?? slugs.length} page${(data.affected ?? slugs.length) !== 1 ? "s" : ""} ${action === "restore" ? "restored" : "deleted"}`);
      }
    } catch {
      toast.error(`Couldn't ${action} pages — check your connection and try again.`);
    } finally {
      setArchiveBusy(false);
      router.refresh();
    }
  }

  async function confirmPendingDelete() {
    if (!pendingDelete) return;
    const { kind, ids } = pendingDelete;
    if (kind === "flag") await runDisposition(ids, "delete");
    else await runArchiveAction(ids, "delete");
    setPendingDelete(null);
  }

  function copyAuditPrompt() {
    navigator.clipboard.writeText(AUDIT_PROMPT).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function Row({ flag, inCluster = false }: { flag: FlagRow; inCluster?: boolean }) {
    return (
      <div className={`cleanup-row${inCluster ? " cleanup-row--cluster" : ""}${previewSlug === flag.slug ? " cleanup-row--previewing" : ""}`}>
        <button className="cleanup-row-main" onClick={() => setPreviewSlug(previewSlug === flag.slug ? null : flag.slug)}>
          <div className="cleanup-row-top">
            <span className="cleanup-title">{flag.title}</span>
            {flag.folderName && <span className="cleanup-folder">{flag.folderName}</span>}
            <span className={`cleanup-chip cleanup-chip--${flag.reason}`}>{flag.reason}</span>
            <span className={`cleanup-conf cleanup-conf--${flag.confidence}`}>{flag.confidence}</span>
          </div>
          <div className="cleanup-evidence">{flag.evidence}</div>
          <div className="cleanup-meta">
            flagged by {flag.flaggedBy} · {fmtDate(flag.flaggedAt)} · content updated {fmtDate(flag.contentUpdatedAt)} · {flag.viewCount} view{flag.viewCount !== 1 ? "s" : ""}
            {flag.supersededBy && <> · superseded by <Link href={`/pages/${flag.supersededBy}`} className="cleanup-link" onClick={(e) => e.stopPropagation()}>{flag.supersededBy}</Link></>}
          </div>
        </button>
        <div className="cleanup-actions">
          <button className="cleanup-btn" onClick={() => setPreviewSlug(previewSlug === flag.slug ? null : flag.slug)}>Review</button>
          <button className="cleanup-btn" disabled={busy} onClick={() => disposition([flag.id], "keep")}>Keep</button>
          <button className="cleanup-btn cleanup-btn--archive" disabled={busy} onClick={() => disposition([flag.id], "archive")}>Archive</button>
          <button className="cleanup-btn cleanup-btn--danger" disabled={busy} onClick={() => disposition([flag.id], "delete")}>Delete</button>
        </div>
      </div>
    );
  }

  function ArchivedRowView({ page }: { page: ArchivedRow }) {
    return (
      <div className="cleanup-row">
        <div className="cleanup-row-main" style={{ cursor: "default" }}>
          <div className="cleanup-row-top">
            <span className="cleanup-title">{page.title}</span>
            {page.folderName && <span className="cleanup-folder">{page.folderName}</span>}
          </div>
          <div className="cleanup-meta">archived · content updated {fmtDate(page.updatedAt)}</div>
        </div>
        <div className="cleanup-actions">
          <Link href={`/pages/${page.slug}`} className="cleanup-btn">Open</Link>
          <button className="cleanup-btn cleanup-btn--archive" disabled={archiveBusy} onClick={() => archiveAction([page.slug], "restore")}>Restore</button>
          <button className="cleanup-btn cleanup-btn--danger" disabled={archiveBusy} onClick={() => archiveAction([page.slug], "delete")}>Delete</button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="dash-root">
        <span className="skel skel-heading" style={{ width: 200 }} />
        <span className="skel skel-block" style={{ height: 200, marginTop: 16 }} />
      </div>
    );
  }

  return (
    <div className="dash-root">
      <div className="cleanup-header">
        <h1 className="cleanup-heading">Cleanup</h1>
        <div className="dash-toolbar-spacer" style={{ flex: 1 }} />
      </div>

      <nav className="settings-tab-bar" style={{ marginBottom: 16 }}>
        <button className={`settings-tab${tab === "flagged" ? " settings-tab--active" : ""}`} onClick={() => selectTab("flagged")}>
          Flagged{rows.length > 0 ? ` (${rows.length})` : ""}
        </button>
        <button className={`settings-tab${tab === "archived" ? " settings-tab--active" : ""}`} onClick={() => selectTab("archived")}>
          Archived{initialArchived.length > 0 ? ` (${initialArchived.length})` : ""}
        </button>
      </nav>

      {tab === "archived" ? (
        initialArchived.length === 0 ? (
          <div className="cleanup-empty">
            <div className="cleanup-empty-title">Nothing archived</div>
            <div className="cleanup-empty-sub">Pages you archive show up here so you can restore or permanently delete them.</div>
          </div>
        ) : (
          <div className="cleanup-body">
            <div className="cleanup-list">
              <div className="cleanup-header" style={{ marginBottom: 4 }}>
                <span className="cleanup-count">{initialArchived.length} archived page{initialArchived.length !== 1 ? "s" : ""}</span>
                <div className="dash-toolbar-spacer" style={{ flex: 1 }} />
                <button
                  className="cleanup-btn cleanup-btn--archive"
                  disabled={archiveBusy}
                  onClick={() => archiveAction(initialArchived.map((p) => p.slug), "restore")}
                >
                  Restore all {initialArchived.length}
                </button>
                <button
                  className="cleanup-btn cleanup-btn--danger"
                  disabled={archiveBusy}
                  onClick={() => archiveAction(initialArchived.map((p) => p.slug), "delete")}
                >
                  Delete all {initialArchived.length}
                </button>
              </div>
              {initialArchived.map((p) => <ArchivedRowView key={p.slug} page={p} />)}
            </div>
          </div>
        )
      ) : rows.length === 0 ? (
        <div className="cleanup-empty">
          <div className="cleanup-empty-title">Queue is clear</div>
          <div className="cleanup-empty-sub">
            {lastSweepAt ? `Last audit activity: ${fmtDate(lastSweepAt)}.` : "No audit has run yet."} Run the cleanup
            audit from any connected agent — it cross-references page content against reality and files flags here.
          </div>
          <button className="cleanup-btn cleanup-btn--archive" onClick={copyAuditPrompt}>
            {copied ? "Copied!" : "Copy audit prompt"}
          </button>
        </div>
      ) : (
        <div className="cleanup-body">
          <div className="cleanup-list">
            <div className="cleanup-header" style={{ marginBottom: 4 }}>
              <span className="cleanup-count">{rows.length} flagged page{rows.length !== 1 ? "s" : ""}</span>
              <div className="dash-toolbar-spacer" style={{ flex: 1 }} />
              <button
                className="cleanup-btn cleanup-btn--archive"
                disabled={busy}
                onClick={() => disposition(rows.map((r) => r.id), "archive")}
                title="Reversible — archived pages keep a restore button"
              >
                Archive all {rows.length}
              </button>
              <button
                className="cleanup-btn cleanup-btn--danger"
                disabled={busy}
                onClick={() => disposition(rows.map((r) => r.id), "delete")}
              >
                Delete all {rows.length}
              </button>
            </div>
            {grouped.clusters.map(([target, members]) => (
              <div key={target} className="cleanup-cluster">
                <div className="cleanup-cluster-label">
                  {members.length} iteration{members.length !== 1 ? "s" : ""} superseded by{" "}
                  <Link href={`/pages/${target}`} className="cleanup-link">{target}</Link>
                </div>
                {members.map((f) => <Row key={f.id} flag={f} inCluster />)}
              </div>
            ))}
            {grouped.singles.map((f) => <Row key={f.id} flag={f} />)}
          </div>
          {previewSlug && (
            <div className="cleanup-preview">
              <div className="cleanup-preview-bar">
                <span>{previewSlug}</span>
                <Link href={`/pages/${previewSlug}`} className="cleanup-link">open</Link>
                <button className="cleanup-preview-close" onClick={() => setPreviewSlug(null)} aria-label="Close preview">&times;</button>
              </div>
              <iframe src={`${basePath}/pages/${previewSlug}`} className="cleanup-preview-frame" title={`Preview of ${previewSlug}`} />
            </div>
          )}
        </div>
      )}
      {pendingDelete && (
        <ConfirmDeleteModal
          title={pendingDelete.ids.length > 1 ? `Permanently delete ${pendingDelete.ids.length} pages?` : `Permanently delete "${pendingDelete.titles[0]}"?`}
          confirmValue={pendingDelete.ids.length > 1 ? String(pendingDelete.ids.length) : null}
          confirmPrompt={<>Type <strong>{pendingDelete.ids.length}</strong> to confirm</>}
          confirmButtonLabel={pendingDelete.ids.length > 1 ? "Delete pages" : "Delete"}
          busyLabel="Deleting…"
          busy={pendingDelete.kind === "flag" ? busy : archiveBusy}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmPendingDelete}
        >
          <p className="confirm-delete-warning">This cannot be undone.</p>
          {pendingDelete.ids.length > 1 && (
            <ul className="confirm-delete-list">
              {pendingDelete.titles.slice(0, 5).map((t, i) => <li key={i}>{t}</li>)}
              {pendingDelete.titles.length > 5 && (
                <li className="confirm-delete-more">+{pendingDelete.titles.length - 5} more</li>
              )}
            </ul>
          )}
        </ConfirmDeleteModal>
      )}
    </div>
  );
}
