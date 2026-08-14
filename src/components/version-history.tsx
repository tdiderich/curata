"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { basePath } from "@/lib/api-fetch";

interface PageVersion {
  id: string;
  contentHash: string;
  createdBy: string;
  createdAt: string;
  yamlContent: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function VersionHistoryPanel({
  slug,
  onClose,
  canApprove = true,
  approversNote = null,
}: {
  slug: string;
  onClose: () => void;
  /** Gates the mark/clear-trusted button — mirrors trust-banner.tsx's gate so both surfaces agree. */
  canApprove?: boolean;
  approversNote?: string | null;
}) {
  const router = useRouter();
  const [versions, setVersions] = useState<PageVersion[] | null>(null);
  const [trustedVersionId, setTrustedVersionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [trustBusy, setTrustBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`${basePath}/api/versions?slug=${encodeURIComponent(slug)}`);
        if (res.ok && !cancelled) {
          const data = (await res.json()) as { versions: PageVersion[]; trustedVersionId: string | null };
          setVersions(data.versions);
          setTrustedVersionId(data.trustedVersionId);
          if (data.versions.length > 0) setSelectedId(data.versions[0].id);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [slug]);

  async function restore(versionId: string) {
    setRestoring(true);
    try {
      const res = await fetch(`${basePath}/api/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, versionId }),
      });
      if (res.ok) {
        onClose();
        router.refresh();
      }
    } finally {
      setRestoring(false);
    }
  }

  async function markTrusted(versionId: string) {
    setTrustBusy(true);
    try {
      const res = await fetch(`${basePath}/api/versions/trust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, versionId }),
      });
      if (res.ok) setTrustedVersionId(versionId);
    } finally {
      setTrustBusy(false);
    }
  }

  async function clearTrusted() {
    setTrustBusy(true);
    try {
      const res = await fetch(`${basePath}/api/versions/trust`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      if (res.ok) setTrustedVersionId(null);
    } finally {
      setTrustBusy(false);
    }
  }

  const selected = versions?.find((v) => v.id === selectedId) ?? null;
  const isCurrent = selected && versions && selected.id === versions[0].id;
  const isTrusted = selected && selected.id === trustedVersionId;

  return (
    <div className="vh-panel">
      <div className="vh-panel-header">
        <span className="vh-panel-title">Version history</span>
        <button className="vh-panel-close" onClick={onClose}>
          &times;
        </button>
      </div>

      {loading && <div className="vh-empty">Loading&hellip;</div>}

      {!loading && versions && versions.length === 0 && (
        <div className="vh-empty">No versions found.</div>
      )}

      {!loading && versions && versions.length > 0 && (
        <div className="vh-body">
          <div className="vh-list">
            {versions.map((v, i) => (
              <button
                key={v.id}
                className={`vh-list-item${selectedId === v.id ? " vh-list-item--active" : ""}`}
                onClick={() => setSelectedId(v.id)}
              >
                <span className="vh-list-date">{formatDate(v.createdAt)}</span>
                <span className="vh-list-meta">
                  <span className="vh-list-author">{v.createdBy}</span>
                  <span className="vh-list-hash">{v.contentHash.slice(0, 8)}</span>
                  {i === 0 && <span className="vh-list-badge">current</span>}
                  {v.id === trustedVersionId && <span className="vh-list-badge vh-list-badge--trusted">trusted</span>}
                </span>
              </button>
            ))}
          </div>

          {selected && (
            <div className="vh-preview">
              <div className="vh-preview-header">
                <span className="vh-preview-label">
                  {isCurrent ? "Current version" : `Version from ${formatDate(selected.createdAt)}`}
                </span>
                <span className="vh-preview-actions">
                  {!isCurrent && (
                    <button
                      className="vh-restore-btn"
                      disabled={restoring}
                      onClick={() => restore(selected.id)}
                    >
                      {restoring ? "Restoring…" : "Restore this version"}
                    </button>
                  )}
                  {canApprove ? (
                    isTrusted ? (
                      <button
                        className="vh-trust-btn"
                        disabled={trustBusy}
                        onClick={() => clearTrusted()}
                      >
                        {trustBusy ? "Clearing…" : "Clear trusted"}
                      </button>
                    ) : (
                      <button
                        className="vh-trust-btn"
                        disabled={trustBusy}
                        onClick={() => markTrusted(selected.id)}
                      >
                        {trustBusy ? "Marking…" : "Mark trusted"}
                      </button>
                    )
                  ) : (
                    approversNote && <span className="vh-approvers-note">{approversNote}</span>
                  )}
                </span>
              </div>
              <pre className="vh-preview-yaml">{selected.yamlContent}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
