"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { basePath } from "@/lib/api-fetch";

export interface NewMapPage { slug: string; title: string; folderName: string | null }
export interface NewMapConcept { term: string; kind: string }
export interface NewMapGroup { term: string; kind: string; needsLook: number; total: number }

interface ExternalDraft { url: string; label: string; owner: string }

/** Client mirror of normalizeTerm: lowercase slug, one interior slash allowed. */
function slugifyTerm(raw: string): string {
  const [head, ...rest] = raw.trim().toLowerCase().split("/");
  const part = (s: string) => s.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const h = part(head ?? ""), t = part(rest.join("-"));
  return h && t ? `${h}/${t}` : h || t;
}

/**
 * New map: start from the change, not from a page. Name it, pick the page
 * that owns the truth (optional), tick everything that needs a look when it
 * moves, paste the links that live outside curata. One submit calls the same
 * map_dependencies an agent would, then lands on /map/<term>.
 */
export interface NewMapInitial {
  term: string;
  kind: string;
  source: string;
  depends: string[];
  external: ExternalDraft[];
  includes: string[];
}

export function NewMapForm({ pages, concepts, groups = [], initialTerm = "", initial }: { pages: NewMapPage[]; concepts: NewMapConcept[]; groups?: NewMapGroup[]; initialTerm?: string; initial?: NewMapInitial }) {
  const router = useRouter();
  const editing = !!initial;
  const [term, setTerm] = useState(initial?.term ?? initialTerm);
  const [kind, setKind] = useState(initial?.kind ?? "");
  const [source, setSource] = useState<string>(initial?.source ?? "");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set(initial?.depends ?? []));
  const [groupQuery, setGroupQuery] = useState("");
  const [pickedGroups, setPickedGroups] = useState<Set<string>>(new Set(initial?.includes ?? []));
  const [externals, setExternals] = useState<ExternalDraft[]>(initial?.external?.length ? initial.external : [{ url: "", label: "", owner: "" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalized = slugifyTerm(term);
  const existing = useMemo(() => concepts.find((c) => c.term === normalized), [concepts, normalized]);
  const suggestions = useMemo(() => {
    const q = normalized.split("/").pop() ?? "";
    if (!q || existing) return [];
    return concepts.filter((c) => c.term.includes(q)).slice(0, 5);
  }, [concepts, normalized, existing]);

  const visiblePages = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? pages.filter((p) => p.title.toLowerCase().includes(q) || p.slug.includes(q) || (p.folderName ?? "").toLowerCase().includes(q))
      : pages;
    return list.filter((p) => p.slug !== source);
  }, [pages, query, source]);

  const validExternals = externals.filter((e) => /^https?:\/\//i.test(e.url.trim()));
  // Edit mode: anything that was on the map and is no longer selected gets detached.
  const removePages = editing
    ? [...(initial!.source ? [initial!.source] : []), ...initial!.depends].filter((slug) => slug !== source && !picked.has(slug))
    : [];
  const removeExternal = editing
    ? initial!.external.map((e) => e.url).filter((u) => !validExternals.some((v) => v.url.trim() === u))
    : [];
  const removeGroups = editing ? initial!.includes.filter((g) => !pickedGroups.has(g)) : [];
  const canSubmit = !!normalized && !busy && (
    picked.size > 0 || validExternals.length > 0 || !!source || pickedGroups.size > 0
    || removePages.length > 0 || removeExternal.length > 0 || removeGroups.length > 0
  );

  function toggle(slug: string) {
    setPicked((s) => { const n = new Set(s); if (n.has(slug)) n.delete(slug); else n.add(slug); return n; });
  }
  function toggleGroup(term: string) {
    setPickedGroups((s) => { const n = new Set(s); if (n.has(term)) n.delete(term); else n.add(term); return n; });
  }

  const visibleGroups = useMemo(() => {
    const q = groupQuery.trim().toLowerCase();
    const list = q ? groups.filter((g) => g.term.includes(q) || g.kind.includes(q)) : groups;
    return list.filter((g) => g.term !== normalized);
  }, [groups, groupQuery, normalized]);

  async function submit() {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`${basePath}/api/dependents/map`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          term: normalized,
          kind: kind || undefined,
          asserts: source ? [source] : [],
          depends: [...picked],
          external: validExternals.map((e) => ({ url: e.url.trim(), label: e.label.trim() || undefined, owner: e.owner.trim() || undefined })),
          includes: [...pickedGroups],
          removePages,
          removeExternal,
          removeIncludes: removeGroups,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      router.push(`/map/${body.term}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="nmf">
      <section className="nmf-step">
        <label className="nmf-label" htmlFor="nmf-term">What is changing?</label>
        <p className="nmf-hint">Short name for the thing, namespaced with one slash: <code>pricing/tier-2</code>, <code>messaging/tagline</code>, <code>feature/sso</code>.</p>
        <div className="nmf-row">
          <input id="nmf-term" className="stg-input nmf-term" placeholder="pricing/tier-2" value={term} onChange={(e) => setTerm(e.target.value)} autoFocus={!editing} disabled={editing} title={editing ? "Rename is not supported yet; make a new map" : undefined} />
          <select className="stg-input nmf-kind" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
            <option value="">kind (optional)</option>
            {["pricing", "feature", "messaging", "api", "process", "release", "vendor", "topic"].map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        {normalized && normalized !== term.trim() && <div className="nmf-hint">Saved as <code>{normalized}</code></div>}
        {existing && !editing && <div className="nmf-note">A map for <code>{existing.term}</code> already exists. This adds to it, nothing gets removed.</div>}
        {suggestions.length > 0 && (
          <div className="nmf-hint">Similar existing: {suggestions.map((s) => (
            <button key={s.term} type="button" className="nmf-chip" onClick={() => setTerm(s.term)}>{s.term}</button>
          ))}</div>
        )}
      </section>

      <section className="nmf-step">
        <label className="nmf-label" htmlFor="nmf-source">Which page owns the truth? <span className="nmf-opt">optional</span></label>
        <p className="nmf-hint">When this page changes, everything below is marked as needing a look. Leave blank if the source lives outside curata.</p>
        <select id="nmf-source" className="stg-input" value={source} onChange={(e) => { setSource(e.target.value); setPicked((s) => { const n = new Set(s); n.delete(e.target.value); return n; }); }}>
          <option value="">No source page</option>
          {pages.map((p) => <option key={p.slug} value={p.slug}>{p.title || p.slug}{p.folderName ? ` · ${p.folderName}` : ""}</option>)}
        </select>
      </section>

      <section className="nmf-step">
        <div className="nmf-label">What needs a look when it changes? <span className="nmf-count">{picked.size} selected</span></div>
        <input className="stg-input" placeholder="Filter pages" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter pages" />
        <ul className="nmf-pages" role="listbox" aria-multiselectable>
          {visiblePages.map((p) => {
            const on = picked.has(p.slug);
            return (
              <li key={p.slug}>
                <label className={`nmf-page${on ? " nmf-page--on" : ""}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(p.slug)} />
                  <span className="nmf-page-title">{p.title || p.slug}</span>
                  {p.folderName && <span className="nmf-page-folder">{p.folderName}</span>}
                </label>
              </li>
            );
          })}
          {visiblePages.length === 0 && <li className="nmf-empty">No pages match.</li>}
        </ul>
      </section>

      <section className="nmf-step">
        <div className="nmf-label">Reuse an existing map? <span className="nmf-opt">optional</span></div>
        <p className="nmf-hint">A group like sales-enablement can back more than one change. Its rows show up here too, checked once for this map only.</p>
        {groups.length === 0 ? (
          <div className="nmf-hint">No other maps to reuse yet.</div>
        ) : (
          <>
            <input className="stg-input" placeholder="Filter maps" value={groupQuery} onChange={(e) => setGroupQuery(e.target.value)} aria-label="Filter maps" />
            <ul className="nmf-pages nmf-groups" role="listbox" aria-multiselectable>
              {visibleGroups.map((g) => {
                const on = pickedGroups.has(g.term);
                return (
                  <li key={g.term}>
                    <label className={`nmf-page${on ? " nmf-page--on" : ""}`}>
                      <input type="checkbox" checked={on} onChange={() => toggleGroup(g.term)} />
                      <span className="nmf-page-title nmf-page-title--mono">{g.term}</span>
                      <span className="nmf-page-folder">{g.total === 0 ? "empty" : `${g.needsLook} of ${g.total} need a look`}</span>
                    </label>
                  </li>
                );
              })}
              {visibleGroups.length === 0 && <li className="nmf-empty">No maps match.</li>}
            </ul>
          </>
        )}
      </section>

      <section className="nmf-step">
        <div className="nmf-label">Anything outside curata? <span className="nmf-opt">optional</span></div>
        <p className="nmf-hint">Decks, docs, dashboards, repo files. Paste the link, name it, say who owns it.</p>
        <div className="nmf-ext-list">
          {externals.map((e, i) => (
            <div key={i} className="nmf-ext-row">
              <input className="stg-input" placeholder="https://" value={e.url} onChange={(ev) => setExternals((xs) => xs.map((x, j) => j === i ? { ...x, url: ev.target.value } : x))} aria-label="URL" />
              <input className="stg-input" placeholder="Label" value={e.label} onChange={(ev) => setExternals((xs) => xs.map((x, j) => j === i ? { ...x, label: ev.target.value } : x))} aria-label="Label" />
              <input className="stg-input" placeholder="Owner" value={e.owner} onChange={(ev) => setExternals((xs) => xs.map((x, j) => j === i ? { ...x, owner: ev.target.value } : x))} aria-label="Owner" />
              <button type="button" className="stg-qbtn" onClick={() => setExternals((xs) => xs.length === 1 ? [{ url: "", label: "", owner: "" }] : xs.filter((_, j) => j !== i))} aria-label="Remove link">×</button>
            </div>
          ))}
        </div>
        <button type="button" className="stg-qbtn" onClick={() => setExternals((xs) => [...xs, { url: "", label: "", owner: "" }])}>+ Add another link</button>
      </section>

      <footer className="nmf-footer">
        {error && <span className="stg-dep-verify-error">{error}</span>}
        <span className="nmf-summary">
          {normalized ? <code>{normalized}</code> : "unnamed"} · {source ? "1 source" : "no source"} · {picked.size} page{picked.size === 1 ? "" : "s"} · {validExternals.length} link{validExternals.length === 1 ? "" : "s"}
          {pickedGroups.size > 0 && <> · {pickedGroups.size} reused map{pickedGroups.size === 1 ? "" : "s"}</>}
          {editing && removePages.length + removeExternal.length + removeGroups.length > 0 && <> · removing {removePages.length + removeExternal.length + removeGroups.length}</>}
        </span>
        <button type="button" className="btn btn--primary" disabled={!canSubmit} onClick={() => void submit()}>
          {busy ? "Saving" : editing ? "Save map" : "Create map"}
        </button>
      </footer>
    </div>
  );
}
