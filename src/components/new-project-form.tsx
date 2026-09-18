"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { basePath } from "@/lib/api-fetch";

export interface NewProjectTemplate { term: string; kind: string; total: number; needsLook: number }
interface TemplatePreview {
  term: string;
  own: Array<{ label: string; kind: "page" | "external" }>;
  includes: Array<{ term: string; own: Array<{ label: string; kind: "page" | "external" }> }>;
}

/** Client mirror of normalizeTerm: lowercase slug, one interior slash allowed. */
function slugifyTerm(raw: string): string {
  const [head, ...rest] = raw.trim().toLowerCase().split("/");
  const part = (s: string) => s.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const h = part(head ?? ""), t = part(rest.join("-"));
  return h && t ? `${h}/${t}` : h || t;
}

/**
 * New project: name it, pick zero or more maps to clone (each one's own
 * items become independent, each one's sub-maps stay a live, shared
 * checklist), see exactly what that will bring in before committing,
 * optionally pick the page this project is tracking against. One submit
 * calls create_project and lands on /projects/<term>.
 */
export function NewProjectForm({ templates }: { templates: NewProjectTemplate[] }) {
  const router = useRouter();
  const [term, setTerm] = useState("");
  const [title, setTitle] = useState("");
  const [templateQuery, setTemplateQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, TemplatePreview>>({});
  const [loadingPreview, setLoadingPreview] = useState(false);

  const normalized = slugifyTerm(term);
  const visibleTemplates = useMemo(() => {
    const q = templateQuery.trim().toLowerCase();
    return q ? templates.filter((t) => t.term.includes(q) || t.kind.includes(q)) : templates;
  }, [templates, templateQuery]);

  function toggle(term: string) {
    setPicked((s) => { const n = new Set(s); if (n.has(term)) n.delete(term); else n.add(term); return n; });
  }

  // Fetch (and cache) a preview the moment a template gets checked. State
  // updates happen after the await, inside the async IIFE, never
  // synchronously in the effect body.
  useEffect(() => {
    const missing = [...picked].filter((t) => !previews[t]);
    if (missing.length === 0) return;
    void (async () => {
      setLoadingPreview(true);
      try {
        const qs = missing.map((t) => `term=${encodeURIComponent(t)}`).join("&");
        const res = await fetch(`${basePath}/api/projects/preview?${qs}`);
        const rows: TemplatePreview[] = res.ok ? await res.json() : [];
        setPreviews((prev) => {
          const next = { ...prev };
          for (const r of rows) next[r.term] = r;
          return next;
        });
      } finally {
        setLoadingPreview(false);
      }
    })();
  }, [picked, previews]);

  const activePreviews = [...picked].map((t) => previews[t]).filter((p): p is TemplatePreview => !!p);
  const previewOwnCount = new Set(activePreviews.flatMap((p) => p.own.map((o) => o.label))).size;
  const previewIncludes = new Map<string, { own: number }>();
  for (const p of activePreviews) for (const inc of p.includes) previewIncludes.set(inc.term, { own: inc.own.length });

  const canSubmit = !!normalized && !!title.trim() && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${basePath}/api/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ term: normalized, title: title.trim(), templateTerms: [...picked] }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      router.push(`/projects/${body.term}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="nmf">
      <section className="nmf-step">
        <label className="nmf-label" htmlFor="npf-title">What are you running?</label>
        <p className="nmf-hint">A name people will recognize, and a short id for it: <code>product-launch/sso</code>, <code>compliance/soc2-q4</code>.</p>
        <div className="nmf-row">
          <input id="npf-title" className="stg-input" placeholder="Launch: SSO" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          <input className="stg-input nmf-term" placeholder="product-launch/sso" value={term} onChange={(e) => setTerm(e.target.value)} />
        </div>
        {normalized && normalized !== term.trim() && <div className="nmf-hint">Saved as <code>{normalized}</code></div>}
      </section>

      <section className="nmf-step">
        <div className="nmf-label">Clone from any maps? <span className="nmf-opt">optional, pick any number</span></div>
        <p className="nmf-hint">Each one&rsquo;s own depends/external become independent items you can check off here. Anything a map includes stays a shared checklist, verified per project.</p>
        {templates.length === 0 ? (
          <div className="nmf-hint">No maps to clone from yet. This will start blank.</div>
        ) : (
          <>
            <input className="stg-input" placeholder="Filter maps" value={templateQuery} onChange={(e) => setTemplateQuery(e.target.value)} />
            <ul className="nmf-pages nmf-groups" role="listbox" aria-multiselectable>
              {visibleTemplates.map((t) => {
                const on = picked.has(t.term);
                return (
                  <li key={t.term}>
                    <label className={`nmf-page${on ? " nmf-page--on" : ""}`}>
                      <input type="checkbox" checked={on} onChange={() => toggle(t.term)} />
                      <span className="nmf-page-title nmf-page-title--mono">{t.term}</span>
                      <span className="nmf-page-folder">{t.total === 0 ? "empty" : `${t.needsLook} of ${t.total} need a look`}</span>
                    </label>
                  </li>
                );
              })}
              {visibleTemplates.length === 0 && <li className="nmf-empty">No maps match.</li>}
            </ul>
          </>
        )}

        {picked.size > 0 && (
          <div className="npf-preview">
            <div className="npf-preview-head">
              {loadingPreview && activePreviews.length < picked.size ? "Loading what this brings in…" : `This clones ${previewOwnCount} item${previewOwnCount === 1 ? "" : "s"}${previewIncludes.size > 0 ? `, plus ${previewIncludes.size} shared checklist${previewIncludes.size === 1 ? "" : "s"}` : ""}:`}
            </div>
            {activePreviews.map((p) => (
              <div key={p.term} className="npf-preview-group">
                <span className="npf-preview-source">{p.term}</span>
                {p.own.length === 0 && p.includes.length === 0 ? (
                  <span className="stg-dep-when">nothing to clone</span>
                ) : (
                  <ul className="npf-preview-list">
                    {p.own.map((o, i) => <li key={i}>{o.label}</li>)}
                    {p.includes.map((inc) => (
                      <li key={inc.term} className="npf-preview-include">
                        <span className="nmf-page-title--mono">{inc.term}</span> — shared checklist, {inc.own.length} item{inc.own.length === 1 ? "" : "s"}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <footer className="nmf-footer">
        {error && <span className="stg-dep-verify-error">{error}</span>}
        <span className="nmf-summary">
          {normalized ? <code>{normalized}</code> : "unnamed"} {picked.size > 0 && <>· cloning {picked.size} map{picked.size === 1 ? "" : "s"}</>}
        </span>
        <button type="button" className="btn btn--primary" disabled={!canSubmit} onClick={() => void submit()}>
          {busy ? "Creating" : "Create project"}
        </button>
      </footer>
    </div>
  );
}
