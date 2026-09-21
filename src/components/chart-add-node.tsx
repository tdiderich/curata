"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { basePath } from "@/lib/api-fetch";

/**
 * "+ Add to chart": pick a page, it becomes a top-level node. Most nodes
 * appear on their own (a template with instances, a page three others
 * depend on); this is for the one you want on the chart before that.
 */
export function AddNodeButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Array<{ slug: string; title: string }>>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = q.trim();
    const t = setTimeout(() => {
      void (async () => {
        if (query.length < 2) { setResults([]); return; }
        try {
          const res = await fetch(`${basePath}/api/search?query=${encodeURIComponent(query)}`);
          const rows: Array<{ slug: string; title: string; type: string }> = res.ok ? await res.json() : [];
          setResults(rows.filter((r) => r.type === "page").slice(0, 8).map((r) => ({ slug: r.slug, title: r.title })));
        } catch { setResults([]); }
      })();
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  async function promote(slug: string) {
    setBusy(slug); setError(null);
    try {
      const res = await fetch(`${basePath}/api/chart`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setOpen(false); setQ(""); setResults([]);
      router.push(`/chart/${String(body.term).split("/").map(encodeURIComponent).join("/")}`);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setBusy(null); }
  }

  if (!open) return <button type="button" className="btn btn--primary" onClick={() => setOpen(true)}>+ Add to chart</button>;
  return (
    <div className="chart-addnode">
      <div className="chart-addnode-pop">
      <input autoFocus className="stg-input" placeholder="Which page is the source of truth?" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); setQ(""); } if (e.key === "Enter" && results[0]) void promote(results[0].slug); }} />
      {results.length > 0 && (
        <div className="chart-addnode-results">
          {results.map((r) => (
            <button key={r.slug} type="button" className="chart-addnode-row" disabled={busy === r.slug} onClick={() => void promote(r.slug)}>
              <span>{r.title}</span><span className="stg-pcount">{r.slug}</span>
            </button>
          ))}
        </div>
      )}
      {q.trim().length >= 2 && results.length === 0 && <div className="scope-empty">No pages match.</div>}
      {error && <div className="stg-dep-verify-error">{error}</div>}
      <button type="button" className="stg-qbtn" onClick={() => { setOpen(false); setQ(""); }}>Cancel</button>
      </div>
    </div>
  );
}
