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

export function VersionHistoryPanel({ slug, onClose }: { slug: string; onClose: () => void }) {
  const router = useRouter();
  const [versions, setVersions] = useState<PageVersion[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`${basePath}/api/versions?slug=${encodeURIComponent(slug)}`);
        if (res.ok && !cancelled) {
          const data = (await res.json()) as PageVersion[];
          setVersions(data);
          if (data.length > 0) setSelectedId(data[0].id);
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

  const selected = versions?.find((v) => v.id === selectedId) ?? null;
  const isCurrent = selected && versions && selected.id === versions[0].id;

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
                  <span className="vh-list-hash">{v.contentHash.slice(0, 8)}</span>
                  {i === 0 && <span className="vh-list-badge">current</span>}
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
                {!isCurrent && (
                  <button
                    className="vh-restore-btn"
                    disabled={restoring}
                    onClick={() => restore(selected.id)}
                  >
                    {restoring ? "Restoring…" : "Restore this version"}
                  </button>
                )}
              </div>
              <pre className="vh-preview-yaml">{selected.yamlContent}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
