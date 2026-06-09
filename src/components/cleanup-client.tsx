"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "@/components/toast";
import { basePath } from "@/lib/api-fetch";

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

export function CleanupClient() {
  const router = useRouter();
  const [flags, setFlags] = useState<FlagRow[]>([]);
  const [lastSweepAt, setLastSweepAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewSlug, setPreviewSlug] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

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

  const highConfidence = useMemo(
    () => rows.filter((r) => r.confidence === "high" && (r.action === "archive" || r.action === "supersede")),
    [rows]
  );

  async function disposition(flagIds: string[], d: "archive" | "delete" | "keep" | "snooze") {
    if (d === "delete" && !confirm(`Permanently delete ${flagIds.length} page${flagIds.length !== 1 ? "s" : ""}? Archive is reversible; this is not.`)) return;
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
    setSelected(new Set());
    setPreviewSlug(null);
    if (ok > 0) {
      const verb = d === "keep" ? "kept" : d === "snooze" ? "snoozed" : `${d}d`;
      toast.success(`${ok} page${ok !== 1 ? "s" : ""} ${verb}`);
    }
    if (failed > 0) toast.error(`${failed} disposition${failed !== 1 ? "s" : ""} failed — retry from the queue.`);
    await load();
    router.refresh();
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
        <input
          type="checkbox"
          className="cleanup-check"
          checked={selected.has(flag.id)}
          onChange={() => toggleSelect(flag.id)}
          aria-label={`Select ${flag.title}`}
        />
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
          <button className="cleanup-btn cleanup-btn--archive" disabled={busy} onClick={() => disposition([flag.id], "archive")}>Archive</button>
          <button className="cleanup-btn cleanup-btn--danger" disabled={busy} onClick={() => disposition([flag.id], "delete")}>Delete</button>
          <button className="cleanup-btn" disabled={busy} onClick={() => disposition([flag.id], "keep")}>Keep</button>
          <button className="cleanup-btn" disabled={busy} onClick={() => disposition([flag.id], "snooze")} title="Hide for 30 days">Snooze</button>
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
        <span className="cleanup-count">{rows.length} flagged page{rows.length !== 1 ? "s" : ""}</span>
        <div className="dash-toolbar-spacer" style={{ flex: 1 }} />
        {selected.size > 0 && (
          <>
            <button className="cleanup-btn cleanup-btn--archive" disabled={busy} onClick={() => disposition([...selected], "archive")}>
              Archive {selected.size} selected
            </button>
            <button className="cleanup-btn" disabled={busy} onClick={() => disposition([...selected], "keep")}>
              Keep {selected.size}
            </button>
          </>
        )}
        {selected.size === 0 && highConfidence.length > 0 && (
          <button
            className="cleanup-btn cleanup-btn--archive"
            disabled={busy}
            onClick={() => disposition(highConfidence.map((r) => r.id), "archive")}
          >
            Archive all {highConfidence.length} high-confidence
          </button>
        )}
      </div>

      {rows.length === 0 ? (
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
            {grouped.clusters.map(([target, members]) => (
              <div key={target} className="cleanup-cluster">
                <div className="cleanup-cluster-label">
                  {members.length} iteration{members.length !== 1 ? "s" : ""} superseded by{" "}
                  <Link href={`/pages/${target}`} className="cleanup-link">{target}</Link>
                  <button
                    className="cleanup-btn cleanup-btn--archive"
                    disabled={busy}
                    onClick={() => disposition(members.map((m) => m.id), "archive")}
                  >
                    Archive group
                  </button>
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
    </div>
  );
}
