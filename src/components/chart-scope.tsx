"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { basePath } from "@/lib/api-fetch";
import type { ChartChild } from "@/lib/chart";
import type { PageSuggestion, ScopeSuggestion } from "@/lib/scope";
import type { CheckRecipe } from "@/lib/check-recipes";

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${basePath}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Add related content: what curata found that probably belongs under this
 * node, ranked by where it came from. One click adds. Detected content
 * (embeds, template instances, tagged depends) never needs this panel.
 */
/** Header button that opens the composer under the table. */
export function AddRelatedButton() {
  return <button type="button" className="btn btn--primary" onClick={() => window.dispatchEvent(new CustomEvent("scope:toggle"))}>+ Add related content</button>;
}

export function ScopePanel({ term }: { term: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onToggle = () => setOpen((o) => !o);
    window.addEventListener("scope:toggle", onToggle);
    return () => window.removeEventListener("scope:toggle", onToggle);
  }, []);
  const [suggestions, setSuggestions] = useState<ScopeSuggestion[] | null>(null);
  const [pageSugs, setPageSugs] = useState<PageSuggestion[]>([]);
  const [manual, setManual] = useState("");
  const [results, setResults] = useState<Array<{ slug: string; title: string }>>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try { setSuggestions(await call("GET", `/api/chart/scope?term=${encodeURIComponent(term)}`)); } catch { setSuggestions([]); }
      try { setPageSugs(await call("GET", `/api/chart/scope?term=${encodeURIComponent(term)}&kind=pages`)); } catch { setPageSugs([]); }
    })();
  }, [term]);

  // Same search the home bar uses. A URL skips search and adds directly.
  useEffect(() => {
    const q = manual.trim();
    const skip = q.length < 2 || /^https?:\/\//i.test(q);
    const t = setTimeout(() => {
      void (async () => {
        if (skip) { setResults([]); return; }
        try {
          const rows: Array<{ slug: string; title: string; type: string }> = await call("GET", `/api/search?query=${encodeURIComponent(q)}`);
          setResults(rows.filter((r) => r.type === "page").slice(0, 8).map((r) => ({ slug: r.slug, title: r.title })));
        } catch { setResults([]); }
      })();
    }, 180);
    return () => clearTimeout(t);
  }, [manual]);

  async function add(input: { url?: string; slug?: string; label?: string; check?: CheckRecipe | null }) {
    const key = input.url ?? input.slug ?? "";
    setBusy(key);
    setError(null);
    try {
      await call("POST", "/api/chart/scope", { term, ...input });
      setSuggestions((s) => (s ?? []).filter((x) => x.url !== input.url));
      if (input.slug) setPageSugs((s) => s.filter((x) => x.slug !== input.slug));
      setManual("");
      setResults([]);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  function addManual() {
    const v = manual.trim();
    if (!v) return;
    if (/^https?:\/\//i.test(v)) void add({ url: v });
    else void add({ slug: v.replace(/^\/?pages\//, "") });
  }

  const groups: Array<[ScopeSuggestion["why"], string]> = [
    ["in source body", "In the source page's body"],
    ["in a child's body", "Linked from content already under it"],
    ["declared by a sibling", "Under a sibling node in the same folder"],
  ];

  if (!open) return null;
  return (
    <div className="scope-composer">
      <div className="scope-manual">
        <input
          autoFocus
          className="stg-input"
          placeholder="Search pages, or paste a URL"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") { setOpen(false); setManual(""); }
            if (e.key === "Enter") { e.preventDefault(); if (results.length > 0 && !/^https?:\/\//i.test(manual)) void add({ slug: results[0].slug }); else addManual(); }
          }}
        />
        <button type="button" className="stg-qbtn" disabled={!manual.trim() || busy !== null} onClick={addManual}>Add</button>
      </div>
      {results.length > 0 && (
        <div className="scope-group">
          {results.map((r) => (
            <div key={r.slug} className="scope-sug">
              <div className="scope-sug-main">
                <span className="scope-sug-label">{r.title}</span>
                <span className="scope-sug-url">{r.slug}</span>
              </div>
              <button type="button" className="stg-qbtn" disabled={busy === r.slug} onClick={() => void add({ slug: r.slug })}>{busy === r.slug ? "…" : "Add"}</button>
            </div>
          ))}
        </div>
      )}
      {results.length === 0 && manual.trim().length < 2 && (
        <>
      {suggestions === null && <div className="scope-empty">Looking for suggestions…</div>}
      {suggestions && suggestions.length === 0 && pageSugs.length === 0 && <div className="scope-empty">Nothing to suggest yet. Search a page or paste a URL above.</div>}
      {pageSugs.length > 0 && (
        <div className="scope-group">
          <div className="scope-group-label">Pages that mention it, not under it</div>
          {pageSugs.map((s) => (
            <div key={s.slug} className="scope-sug">
              <div className="scope-sug-main">
                <span className="scope-sug-label">{s.title}</span>
                <span className="scope-sug-url">{s.slug} · mentions &ldquo;{s.matched}&rdquo;</span>
              </div>
              <button type="button" className="stg-qbtn" disabled={busy === s.slug} onClick={() => void add({ slug: s.slug })}>{busy === s.slug ? "…" : "Add"}</button>
            </div>
          ))}
        </div>
      )}
      {suggestions && groups.map(([why, label]) => {
        const rows = suggestions.filter((s) => s.why === why);
        if (rows.length === 0) return null;
        return (
          <div key={why} className="scope-group">
            <div className="scope-group-label">{label}</div>
            {rows.map((s) => (
              <div key={s.url} className="scope-sug">
                <div className="scope-sug-main">
                  <span className="scope-sug-label">{s.label}</span>
                  <span className="scope-sug-url">{s.host ?? s.url}{s.referencedBy > 1 ? ` · ${s.referencedBy} pages` : ""}{s.suggestedCheck ? ` · checkable via ${s.suggestedCheck.via}` : ""}</span>
                </div>
                <button type="button" className="stg-qbtn" disabled={busy === s.url} onClick={() => void add({ url: s.url, label: s.label, check: s.suggestedCheck })}>{busy === s.url ? "…" : "Add"}</button>
              </div>
            ))}
          </div>
        );
      })}
        </>
      )}
      {error && <div className="stg-dep-verify-error">{error}</div>}
    </div>
  );
}

/** Owner and due date on an external row. Owner is on the asset (shared), due is on this node's edge. */
export function ScopeOwnerDue({ child, term }: { child: ChartChild; term: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [owner, setOwner] = useState(child.owner ?? "");
  const [due, setDue] = useState(child.dueAt ? child.dueAt.slice(0, 10) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true); setError(null);
    try {
      await call("PATCH", "/api/chart/scope", { url: child.url, term, owner: owner.trim() || null, dueAt: due || null });
      setEditing(false);
      router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); }
  }

  if (!editing) {
    return (
      <button type="button" className="stg-qbtn chart-owner-btn" onClick={() => setEditing(true)} title="Set owner and due date">
        {child.owner ?? "no owner"}{child.dueAt ? ` · ${child.dueAt.slice(0, 10)}` : ""}
      </button>
    );
  }
  return (
    <span className="scope-edit">
      <input className="stg-input" placeholder="Owner" value={owner} onChange={(e) => setOwner(e.target.value)} autoFocus disabled={busy} />
      <input className="stg-input" type="date" value={due} onChange={(e) => setDue(e.target.value)} disabled={busy} />
      <button type="button" className="stg-qbtn" disabled={busy} onClick={() => void save()}>{busy ? "…" : "Save"}</button>
      <button type="button" className="stg-qbtn stg-qbtn--ghost" onClick={() => setEditing(false)}>Cancel</button>
      {error && <span className="stg-dep-verify-error">{error}</span>}
    </span>
  );
}

/** How an agent checks this asset. Shows the recipe, or offers the by-domain suggestion, or says human only. */
export function ScopeRecipe({ child, suggested }: { child: ChartChild; suggested: CheckRecipe | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const recipe = (child.check as CheckRecipe | null) ?? null;
  async function set(check: CheckRecipe | null) {
    setBusy(true);
    try { await call("PATCH", "/api/chart/scope", { url: child.url, check }); router.refresh(); } finally { setBusy(false); }
  }
  if (recipe) {
    return (
      <span className="scope-recipe" title={recipe.ask ?? ""}>
        agent checks via <code>{recipe.via}</code>{recipe.tool ? <> · <code>{recipe.tool}</code></> : null}
        <button type="button" className="scope-recipe-x" disabled={busy} onClick={() => void set(null)} title="Clear recipe">×</button>
      </span>
    );
  }
  if (suggested) {
    return (
      <span className="scope-recipe scope-recipe--sug">
        human only · <button type="button" className="scope-inline" disabled={busy} onClick={() => void set(suggested)}>let agents check via {suggested.via}</button>
      </span>
    );
  }
  return <span className="scope-recipe scope-recipe--none">human only</span>;
}

export function ScopeRemove({ child, term }: { child: ChartChild; term: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    try { await call("DELETE", "/api/chart/scope", { term, slug: child.slug ?? undefined, url: child.url ?? undefined }); router.refresh(); } finally { setBusy(false); }
  }
  return <button type="button" className="stg-qbtn stg-qbtn--danger" disabled={busy} onClick={() => void remove()} title="Take it out from under this node">Remove</button>;
}
