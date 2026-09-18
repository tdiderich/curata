"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { basePath } from "@/lib/api-fetch";

export interface NewProjectPage { slug: string; title: string; folderName: string | null }
export interface NewProjectTemplate { term: string; kind: string; total: number; needsLook: number }

/** Client mirror of normalizeTerm: lowercase slug, one interior slash allowed. */
function slugifyTerm(raw: string): string {
  const [head, ...rest] = raw.trim().toLowerCase().split("/");
  const part = (s: string) => s.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const h = part(head ?? ""), t = part(rest.join("-"));
  return h && t ? `${h}/${t}` : h || t;
}

/**
 * New project: name it, optionally clone a map (its own depends/external
 * become independent items here; anything it includes stays a live,
 * shared checklist), optionally pick the page that owns the truth. One
 * submit calls create_project and lands on /projects/<term>.
 */
export function NewProjectForm({ pages, templates }: { pages: NewProjectPage[]; templates: NewProjectTemplate[] }) {
  const router = useRouter();
  const [term, setTerm] = useState("");
  const [title, setTitle] = useState("");
  const [templateQuery, setTemplateQuery] = useState("");
  const [templateTerm, setTemplateTerm] = useState("");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalized = slugifyTerm(term);
  const visibleTemplates = useMemo(() => {
    const q = templateQuery.trim().toLowerCase();
    return q ? templates.filter((t) => t.term.includes(q) || t.kind.includes(q)) : templates;
  }, [templates, templateQuery]);

  const canSubmit = !!normalized && !!title.trim() && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${basePath}/api/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ term: normalized, title: title.trim(), templateTerm: templateTerm || undefined, source: source || undefined }),
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
        <div className="nmf-label">Clone from a map? <span className="nmf-opt">optional</span></div>
        <p className="nmf-hint">Its own depends/external become independent items you can check off here. Anything it includes stays a shared checklist, verified per project.</p>
        {templates.length === 0 ? (
          <div className="nmf-hint">No maps to clone from yet. This will start blank.</div>
        ) : (
          <>
            <input className="stg-input" placeholder="Filter maps" value={templateQuery} onChange={(e) => setTemplateQuery(e.target.value)} />
            <ul className="nmf-pages nmf-groups" role="listbox">
              <li>
                <label className={`nmf-page${templateTerm === "" ? " nmf-page--on" : ""}`}>
                  <input type="radio" name="template" checked={templateTerm === ""} onChange={() => setTemplateTerm("")} />
                  <span className="nmf-page-title">Start blank</span>
                </label>
              </li>
              {visibleTemplates.map((t) => (
                <li key={t.term}>
                  <label className={`nmf-page${templateTerm === t.term ? " nmf-page--on" : ""}`}>
                    <input type="radio" name="template" checked={templateTerm === t.term} onChange={() => setTemplateTerm(t.term)} />
                    <span className="nmf-page-title nmf-page-title--mono">{t.term}</span>
                    <span className="nmf-page-folder">{t.total === 0 ? "empty" : `${t.needsLook} of ${t.total} need a look`}</span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="nmf-step">
        <label className="nmf-label" htmlFor="npf-source">Which page owns the truth? <span className="nmf-opt">optional</span></label>
        <select id="npf-source" className="stg-input" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">No source page</option>
          {pages.map((p) => <option key={p.slug} value={p.slug}>{p.title || p.slug}{p.folderName ? ` · ${p.folderName}` : ""}</option>)}
        </select>
      </section>

      <footer className="nmf-footer">
        {error && <span className="stg-dep-verify-error">{error}</span>}
        <span className="nmf-summary">
          {normalized ? <code>{normalized}</code> : "unnamed"} {templateTerm && <>· cloning <code>{templateTerm}</code></>}
        </span>
        <button type="button" className="btn btn--primary" disabled={!canSubmit} onClick={() => void submit()}>
          {busy ? "Creating" : "Create project"}
        </button>
      </footer>
    </div>
  );
}
