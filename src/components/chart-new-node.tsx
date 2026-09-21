"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { basePath } from "@/lib/api-fetch";

interface PageHit { slug: string; title: string }
interface Related { key: string; slug?: string; url?: string; label: string; sub: string }

function usePageSearch(q: string, enabled = true) {
  const [hits, setHits] = useState<PageHit[]>([]);
  useEffect(() => {
    const query = q.trim();
    const t = setTimeout(() => {
      void (async () => {
        if (!enabled || query.length < 2 || /^https?:\/\//i.test(query)) { setHits([]); return; }
        try {
          const res = await fetch(`${basePath}/api/search?query=${encodeURIComponent(query)}`);
          const rows: Array<{ slug: string; title: string; type: string }> = res.ok ? await res.json() : [];
          setHits(rows.filter((r) => r.type === "page").slice(0, 8).map((r) => ({ slug: r.slug, title: r.title })));
        } catch { setHits([]); }
      })();
    }, 180);
    return () => clearTimeout(t);
  }, [q, enabled]);
  return hits;
}

/**
 * New top level content item. Three parts: a name, the page that owns the
 * truth (pick one, or create it now from the name), and the related
 * content that goes under it. Related content is the main event; the rest
 * is two fields.
 */
export function NewNodeForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<"existing" | "create">("existing");
  const [sourceQ, setSourceQ] = useState("");
  const [source, setSource] = useState<PageHit | null>(null);
  const [relQ, setRelQ] = useState("");
  const [related, setRelated] = useState<Related[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sourceHits = usePageSearch(sourceQ, mode === "existing" && !source);
  const relHits = usePageSearch(relQ).filter((h) => h.slug !== source?.slug && !related.some((r) => r.slug === h.slug));

  function pickSource(h: PageHit) {
    setSource(h);
    setSourceQ("");
    if (!title.trim()) setTitle(h.title);
  }
  function addRelatedPage(h: PageHit) {
    setRelated((r) => [...r, { key: `p:${h.slug}`, slug: h.slug, label: h.title, sub: h.slug }]);
    setRelQ("");
  }
  function addRelatedUrl() {
    const v = relQ.trim();
    if (!/^https?:\/\//i.test(v)) return;
    let host = v;
    try { host = new URL(v).host.replace(/^www\./, ""); } catch { /* keep raw */ }
    if (related.some((r) => r.url === v)) { setRelQ(""); return; }
    setRelated((r) => [...r, { key: `u:${v}`, url: v, label: host, sub: v }]);
    setRelQ("");
  }

  const canSubmit = !!title.trim() && (mode === "create" || !!source) && !busy;

  async function submit() {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`${basePath}/api/chart`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), slug: mode === "existing" ? source?.slug : undefined, related: related.map((r) => ({ slug: r.slug, url: r.url })) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      router.push(`/map/${String(body.term).split("/").map(encodeURIComponent).join("/")}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="nmf">
      <section className="nmf-step">
        <label className="nmf-label" htmlFor="nn-title">What is it?</label>
        <p className="nmf-hint">The name people will see at the top of the map: <code>Pricing</code>, <code>SSO</code>, <code>Company tagline</code>.</p>
        <input id="nn-title" className="stg-input" placeholder="Pricing" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </section>

      <section className="nmf-step">
        <div className="nmf-label">Which page owns the truth for it?</div>
        <p className="nmf-hint">When this page changes, everything below goes yellow. Pick an existing page, or create one now with the name above.</p>
        <div className="cmap-views nn-mode">
          <button type="button" className={`cmap-view${mode === "existing" ? " cmap-view--on" : ""}`} onClick={() => setMode("existing")}>Existing page</button>
          <button type="button" className={`cmap-view${mode === "create" ? " cmap-view--on" : ""}`} onClick={() => { setMode("create"); setSource(null); }}>Create a new page</button>
        </div>
        {mode === "existing" && (source ? (
          <div className="scope-sug nn-picked">
            <div className="scope-sug-main"><span className="scope-sug-label">{source.title}</span><span className="scope-sug-url">{source.slug}</span></div>
            <button type="button" className="stg-qbtn" onClick={() => setSource(null)}>Change</button>
          </div>
        ) : (
          <>
            <input className="stg-input" placeholder="Search pages" value={sourceQ} onChange={(e) => setSourceQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && sourceHits[0]) { e.preventDefault(); pickSource(sourceHits[0]); } }} />
            {sourceHits.length > 0 && (
              <div className="scope-group">
                {sourceHits.map((h) => (
                  <button key={h.slug} type="button" className="scope-sug nn-hit" onClick={() => pickSource(h)}>
                    <div className="scope-sug-main"><span className="scope-sug-label">{h.title}</span><span className="scope-sug-url">{h.slug}</span></div>
                    <span className="stg-qbtn">Use</span>
                  </button>
                ))}
              </div>
            )}
          </>
        ))}
        {mode === "create" && (
          <p className="nmf-hint">A page titled <code>{title.trim() || "…"}</code> will be created as the source. Write the real content there afterward.</p>
        )}
      </section>

      <section className="nmf-step">
        <div className="nmf-label">Related content <span className="nmf-opt">what needs a look when it changes</span></div>
        <p className="nmf-hint">Pages in curata, or links to things outside it: a HubSpot page, a sales deck, a Zendesk macro. You can add more from the chart later.</p>
        <div className="scope-manual">
          <input
            className="stg-input"
            placeholder="Search pages, or paste a URL"
            value={relQ}
            onChange={(e) => setRelQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (/^https?:\/\//i.test(relQ)) addRelatedUrl(); else if (relHits[0]) addRelatedPage(relHits[0]); } }}
          />
          <button type="button" className="stg-qbtn" disabled={!/^https?:\/\//i.test(relQ.trim())} onClick={addRelatedUrl}>Add link</button>
        </div>
        {relHits.length > 0 && (
          <div className="scope-group">
            {relHits.map((h) => (
              <button key={h.slug} type="button" className="scope-sug nn-hit" onClick={() => addRelatedPage(h)}>
                <div className="scope-sug-main"><span className="scope-sug-label">{h.title}</span><span className="scope-sug-url">{h.slug}</span></div>
                <span className="stg-qbtn">Add</span>
              </button>
            ))}
          </div>
        )}
        {related.length > 0 && (
          <ul className="nn-related">
            {related.map((r) => (
              <li key={r.key} className="scope-sug">
                <div className="scope-sug-main"><span className="scope-sug-label">{r.label}</span><span className="scope-sug-url">{r.sub}</span></div>
                <button type="button" className="stg-qbtn stg-qbtn--danger" onClick={() => setRelated((x) => x.filter((y) => y.key !== r.key))}>Remove</button>
              </li>
            ))}
          </ul>
        )}
        {related.length === 0 && <div className="scope-empty">Nothing yet. Fine to create it empty and add from the map.</div>}
      </section>

      <footer className="nmf-footer">
        {error && <span className="stg-dep-verify-error">{error}</span>}
        <span className="nmf-summary">{title.trim() || "unnamed"}{related.length > 0 && <> · {related.length} under it</>}</span>
        <button type="button" className="btn btn--primary" disabled={!canSubmit} onClick={() => void submit()}>{busy ? "Creating" : "Create"}</button>
      </footer>
    </div>
  );
}
