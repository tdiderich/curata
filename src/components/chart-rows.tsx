"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import yaml from "js-yaml";
import { basePath } from "@/lib/api-fetch";
import type { ChartChild } from "@/lib/chart";
import { suggestCheck, type CheckRecipe } from "@/lib/check-recipes";
import { buildChartPrompt } from "@/lib/chart-prompt";
import { relativeTime } from "@/components/dependency-cells";
import { toast } from "@/components/toast";
import { PageRenderer, type PageData } from "@/generated/kazam-renderer";
import { ScopeOwnerDue, ScopeRecipe, ScopeRemove } from "@/components/chart-scope";
import { ContextMenu, type ContextMenuItem } from "@/components/context-menu";
import { chartHref } from "@/components/chart-view";
import { Favicon } from "@/components/chart-leaves";

function relLabel(c: ChartChild): string {
  if (c.kind === "external") return `external · ${c.host ?? ""}`;
  if (c.rel === "embeds") return "embeds this";
  if (c.rel === "instantiates") return "built from this";
  return "depends on this";
}

/** Short pill label; the full reason rides on the tooltip and in the open row. */
function pillText(c: ChartChild): string {
  if (c.color === "red") return c.reason?.startsWith("mismatch") ? "Mismatch" : c.reason?.startsWith("past due") ? "Past due" : "Needs update";
  if (c.color === "yellow") return c.reason?.startsWith("couldn't check") ? "Couldn't check" : c.lastCheckedAt ? "Changed since" : "Never checked";
  return c.note === "edited" ? "Edited" : "Checked";
}

function stateText(c: ChartChild): string {
  if (c.color === "green") return c.lastCheckedAt ? `checked ${relativeTime(c.lastCheckedAt)}${c.note === "edited" ? ", by edit" : ""}` : "nothing to drift against";
  return `${c.lastCheckedAt ? `checked ${relativeTime(c.lastCheckedAt)} · ` : ""}${c.reason ?? ""}`;
}

type Filter = "all" | "attention" | "red" | "yellow" | "green";

/** Kebab per row: opens the shared context menu with that row's actions. */
function RowMenu({ items }: { items: ContextMenuItem[] }) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button ref={setAnchor} type="button" className="chart-kebab" aria-label="Row actions" onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>···</button>
      <ContextMenu items={items} anchorEl={anchor} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

async function verify(body: Record<string, unknown>) {
  const res = await fetch(`${basePath}/api/dependents/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || `HTTP ${res.status}`); }
}

/** Inline read of a page, rendered the same way the page itself is. Ref blocks show as placeholders here. */
function PagePreview({ slug }: { slug: string }) {
  const [page, setPage] = useState<PageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${basePath}/api/pages/yaml?slug=${encodeURIComponent(slug)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { yaml: text } = await res.json();
        setPage(yaml.load(text) as PageData);
      } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    })();
  }, [slug]);
  if (error) return <div className="scope-empty">Couldn&rsquo;t load the page: {error}</div>;
  if (!page) return <div className="scope-empty">Loading…</div>;
  return <div className="chart-preview"><PageRenderer page={page} /></div>;
}

/**
 * Related content as expandable rows. Click a row to review it here, no
 * navigation. "Mark complete" = looked, still right (mark_verified holds).
 * Checking a row = "needs update": the checked rows are the update queue,
 * and every change to it copies a fresh agent prompt to the clipboard.
 */
/**
 * Related content as a table. Click a row to review it here, no navigation.
 * Checking a row = "needs update": the checked rows are the update queue,
 * and every change to it copies a fresh agent prompt to the clipboard.
 * Per-row actions live in the ··· menu. `header` (stat cards on the node
 * page) renders above the toolbar.
 */
export function ChartRows({ rows, term, canEdit, source, instructions = null, header }: { rows: ChartChild[]; term: string; canEdit: boolean; source: { slug: string; title: string; updatedAt: string } | null; instructions?: string | null; header?: ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  // Everything yellow or red starts checked: that is the update queue by definition. Browsers only allow clipboard writes on a click, so the first copy is the button.
  const [selected, setSelected] = useState<Set<string>>(() => new Set(rows.filter((c) => c.color !== "green").map((c) => c.edgeId)));
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const byId = new Map(rows.map((c) => [c.edgeId, c]));
  const picked = [...selected].map((id) => byId.get(id)).filter((c): c is ChartChild => !!c);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((c) => {
      if (filter === "attention" && c.color === "green") return false;
      if ((filter === "red" || filter === "yellow" || filter === "green") && c.color !== filter) return false;
      if (q && !`${c.label} ${c.slug ?? ""} ${c.host ?? ""} ${c.owner ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, query, filter]);
  const allVisiblePicked = visible.length > 0 && visible.every((c) => selected.has(c.edgeId));

  async function act(rows: ChartChild[], status: "holds") {
    if (rows.length === 0) return;
    setBusy(true);
    try {
      for (const c of rows) await verify({ slug: c.slug ?? undefined, url: c.url ?? undefined, term, status });
      const also = rows.length === 1 ? rows[0].alsoUnder : [];
      toast.success(`${rows.length === 1 ? rows[0].label : `${rows.length} items`} marked complete.${also.length ? ` Still needs a look under ${also.join(", ")}.` : ""}`);
      setSelected(new Set());
      router.refresh();
    } catch (err) { toast.error(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); }
  }

  async function copyPrompt(list: ChartChild[]) {
    const baseUrl = `${window.location.origin}${basePath}`;
    const text = buildChartPrompt({ term, source, instructions, items: list, baseUrl });
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`Prompt for ${list.length} item${list.length === 1 ? "" : "s"} on your clipboard.`);
    } catch { toast.error("Couldn't copy to the clipboard."); }
  }

  /** Checking a row means "this needs an update": the selection is the update queue, and the prompt for the whole queue lands on the clipboard every time it changes. */
  function toggle(id: string, force?: boolean) {
    const n = new Set(selected);
    const on = force ?? !n.has(id);
    if (on) n.add(id); else n.delete(id);
    setSelected(n);
    const list = [...n].map((x) => byId.get(x)).filter((c): c is ChartChild => !!c);
    if (list.length > 0) void copyPrompt(list);
  }

  function toggleAll() {
    const n = new Set(selected);
    if (allVisiblePicked) visible.forEach((c) => n.delete(c.edgeId)); else visible.forEach((c) => n.add(c.edgeId));
    setSelected(n);
  }

  function menuFor(c: ChartChild): ContextMenuItem[] {
    const items: ContextMenuItem[] = [];
    if (c.color !== "green") items.push({ label: "Mark complete", onClick: () => void act([c], "holds") });
    items.push(selected.has(c.edgeId)
      ? { label: "Remove from queue", onClick: () => toggle(c.edgeId, false) }
      : { label: "Needs update", onClick: () => toggle(c.edgeId, true) });
    items.push({ label: "Copy prompt for this", onClick: () => void copyPrompt([c]) });
    items.push({ label: "", divider: true, onClick: () => {} });
    if (c.kind === "page" && c.slug) items.push({ label: "Open page", onClick: () => window.open(`${basePath}/pages/${c.slug}`, "_blank") });
    if (c.kind === "external" && c.url) items.push({ label: "Open link", onClick: () => window.open(c.url!, "_blank", "noreferrer") });
    if (c.kind === "external" || c.rel === "depends") items.push({ label: "Remove from this node", danger: true, onClick: () => document.getElementById(`chart-remove-${c.edgeId}`)?.click() });
    return items;
  }

  return (
    <div className="chart-rows">
      {header}
      <div className="chart-toolbar">
        <input className="stg-input chart-toolbar-search" placeholder="Search content" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select className="stg-input chart-toolbar-select" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Filter by state">
          <option value="all">All states</option>
          <option value="attention">Needs attention</option>
          <option value="red">Red</option>
          <option value="yellow">Yellow</option>
          <option value="green">Checked</option>
        </select>
        <span className="cmap-spacer" />
        {canEdit && (
          <>
            {picked.length > 0 && <span className="chart-toolbar-count">{picked.length} queued</span>}
            <button type="button" className="btn btn--primary" disabled={busy || picked.length === 0} onClick={() => void copyPrompt(picked)}>Copy prompt</button>
            <button type="button" className="btn btn--ghost" disabled={busy || picked.length === 0} onClick={() => void act(picked, "holds")}>Mark complete</button>
          </>
        )}
      </div>
      <div className="chart-rows-head chart-rows-head--table">
        {canEdit && <input type="checkbox" className="chart-check" checked={allVisiblePicked} onChange={toggleAll} aria-label="Select all shown" />}
        <span>Content</span><span>Owner · due</span><span>State</span><span />
      </div>
      {visible.length === 0 && <div className="scope-empty chart-rows-empty">Nothing matches.</div>}
      {visible.map((c) => {
        const isOpen = open === c.edgeId;
        return (
          <div key={c.edgeId} className={`chart-row${isOpen ? " chart-row--open" : ""}`}>
            <div className="chart-row-line" onClick={() => setOpen(isOpen ? null : c.edgeId)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(isOpen ? null : c.edgeId); } }}>
              {canEdit && <input type="checkbox" className="chart-check" checked={selected.has(c.edgeId)} onChange={() => toggle(c.edgeId)} onClick={(e) => e.stopPropagation()} aria-label={`Select ${c.label}`} />}
              <span className="chart-cell-text">
                <span className="chart-row-title">{c.kind === "external" && c.host && <Favicon host={c.host} inline />}{c.label}</span>
                <span className="stg-pcount">
                  {relLabel(c)}
                  {c.alsoUnder.length > 0 && <> · also under {c.alsoUnder.map((t, i) => <span key={t}>{i > 0 && ", "}<Link href={chartHref(t)} className="chart-also-link" onClick={(e) => e.stopPropagation()}>{t}</Link></span>)}</>}
                </span>
              </span>
              <span className="stg-dep-when">{c.owner ?? "—"}{c.dueAt ? ` · ${c.dueAt.slice(0, 10)}` : ""}</span>
              <span className={`pill chart-pill chart-pill--${c.color}`} title={stateText(c)}><span className="pill-dot" />{pillText(c)}</span>
              <span className="chart-row-end" onClick={(e) => e.stopPropagation()}>{canEdit ? <RowMenu items={menuFor(c)} /> : <span className="chart-row-caret" aria-hidden>{isOpen ? "▴" : "▾"}</span>}</span>
            </div>
            {isOpen && (
              <div className="chart-row-body">
                <div className="chart-row-state">{stateText(c)}</div>
                {c.kind === "page" && c.slug ? (
                  <>
                    {c.note && c.note !== "edited" && <div className="chart-row-note">Note: {c.note}</div>}
                    <PagePreview slug={c.slug} />
                  </>
                ) : (
                  <div className="chart-ext-meta">
                    <div className="chart-ext-row"><span className="cmap-source-label">Link</span><a href={c.url ?? "#"} target="_blank" rel="noreferrer" className="stg-dep-link">{c.url}</a></div>
                    <div className="chart-ext-row"><span className="cmap-source-label">Owner · due</span>{canEdit ? <ScopeOwnerDue child={c} term={term} /> : <span>{c.owner ?? "no owner"}{c.dueAt ? ` · ${c.dueAt.slice(0, 10)}` : ""}</span>}</div>
                    <div className="chart-ext-row"><span className="cmap-source-label">How to check</span>{canEdit ? <ScopeRecipe child={c} suggested={c.check ? null : suggestCheck(c.url ?? "")} /> : <span>{(c.check as CheckRecipe | null)?.via ? `agent, via ${(c.check as CheckRecipe).via}` : "a person opens it and looks"}</span>}</div>
                    {c.note && c.note !== "edited" && <div className="chart-ext-row"><span className="cmap-source-label">Last note</span><span>{c.note}</span></div>}
                  </div>
                )}
                {canEdit && (c.kind === "external" || c.rel === "depends") && <span className="chart-row-hidden-remove"><ScopeRemove child={c} term={term} id={`chart-remove-${c.edgeId}`} /></span>}
              </div>
            )}
            {!isOpen && canEdit && (c.kind === "external" || c.rel === "depends") && <span className="chart-row-hidden-remove"><ScopeRemove child={c} term={term} id={`chart-remove-${c.edgeId}`} /></span>}
          </div>
        );
      })}
    </div>
  );
}
