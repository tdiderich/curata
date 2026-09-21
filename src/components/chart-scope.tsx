"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { basePath } from "@/lib/api-fetch";
import type { ChartChild } from "@/lib/chart";
import type { CheckRecipe, PageSuggestion, ScopeSuggestion } from "@/lib/scope";

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
export function ScopePanel({ term }: { term: string }) {
  const router = useRouter();
  const [suggestions, setSuggestions] = useState<ScopeSuggestion[] | null>(null);
  const [pageSugs, setPageSugs] = useState<PageSuggestion[]>([]);
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try { setSuggestions(await call("GET", `/api/chart/scope?term=${encodeURIComponent(term)}`)); } catch { setSuggestions([]); }
      try { setPageSugs(await call("GET", `/api/chart/scope?term=${encodeURIComponent(term)}&kind=pages`)); } catch { setPageSugs([]); }
    })();
  }, [term]);

  async function add(input: { url?: string; slug?: string; label?: string; check?: CheckRecipe | null }) {
    const key = input.url ?? input.slug ?? "";
    setBusy(key);
    setError(null);
    try {
      await call("POST", "/api/chart/scope", { term, ...input });
      setSuggestions((s) => (s ?? []).filter((x) => x.url !== input.url));
      if (input.slug) setPageSugs((s) => s.filter((x) => x.slug !== input.slug));
      setManual("");
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

  return (
    <aside className="scope-panel">
      <div className="scope-panel-title">Add related content</div>
      <p className="scope-panel-hint">Pages and links curata found that might belong under this node. One click adds. Anything detected from templates, embeds or tags is already here.</p>
      {suggestions === null && <div className="scope-empty">Looking…</div>}
      {suggestions && suggestions.length === 0 && pageSugs.length === 0 && <div className="scope-empty">Nothing to suggest. Paste a URL or a page slug below.</div>}
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
      <div className="scope-manual">
        <input
          className="stg-input"
          placeholder="Paste a URL, or type a page slug"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addManual(); } }}
        />
        <button type="button" className="stg-qbtn" disabled={!manual.trim() || busy !== null} onClick={addManual}>Add</button>
      </div>
      {error && <div className="stg-dep-verify-error">{error}</div>}
    </aside>
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
      <button type="button" className="scope-inline" onClick={() => setEditing(true)} title="Set owner and due date">
        {child.owner ?? <span className="chart-td-muted">no owner</span>}{child.dueAt ? ` · ${child.dueAt.slice(0, 10)}` : ""}
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
  return <button type="button" className="scope-inline scope-inline--danger" disabled={busy} onClick={() => void remove()} title="Take it out from under this node">Remove</button>;
}
