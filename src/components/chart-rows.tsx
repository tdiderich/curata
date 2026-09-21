"use client";

import { useEffect, useState } from "react";
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
import { chartHref } from "@/components/chart-view";
import { Favicon } from "@/components/chart-leaves";

function relLabel(c: ChartChild): string {
  if (c.kind === "external") return `external · ${c.host ?? ""}`;
  if (c.rel === "embeds") return "embeds this";
  if (c.rel === "instantiates") return "built from this";
  return "depends on this";
}

function stateText(c: ChartChild): string {
  if (c.color === "green") return c.lastCheckedAt ? `${relativeTime(c.lastCheckedAt)}${c.note === "edited" ? " · edited" : ""}` : "nothing to drift against";
  return `${c.lastCheckedAt ? `${relativeTime(c.lastCheckedAt)} · ` : ""}${c.reason ?? ""}`;
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
export function ChartRows({ rows, term, canEdit, source, instructions = null }: { rows: ChartChild[]; term: string; canEdit: boolean; source: { slug: string; title: string; updatedAt: string } | null; instructions?: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  // Everything yellow or red starts checked: that is the update queue by definition. Browsers only allow clipboard writes on a click, so the first copy is the button.
  const [selected, setSelected] = useState<Set<string>>(() => new Set(rows.filter((c) => c.color !== "green").map((c) => c.edgeId)));
  const [busy, setBusy] = useState(false);

  const byId = new Map(rows.map((c) => [c.edgeId, c]));
  const picked = [...selected].map((id) => byId.get(id)).filter((c): c is ChartChild => !!c);

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

  /**
   * A prompt an agent can run as-is: which source moved, which items are
   * selected, what to do with each kind, and how to record the outcome.
   */
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

  return (
    <div className="chart-rows">
      {canEdit && picked.length > 0 && (
        <div className="chart-head-tools">
          <span className="chart-head-count">{picked.length} need{picked.length === 1 ? "s" : ""} update</span>
          <button type="button" className="btn btn--primary chart-bulk-copy" disabled={busy} onClick={() => void copyPrompt(picked)}>Copy prompt</button>
          <button type="button" className="stg-qbtn" disabled={busy} onClick={() => void act(picked, "holds")}>Mark complete</button>
          <button type="button" className="stg-qbtn stg-qbtn--ghost" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}
      {rows.map((c) => {
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
              <span className={`chart-text--${c.color}`}>{stateText(c)}</span>
              <span className="chart-row-caret" aria-hidden>{isOpen ? "▴" : "▾"}</span>
            </div>
            {isOpen && (
              <div className="chart-row-body">
                {canEdit && (
                  <div className="chart-row-actions">
                    {c.color !== "green" && <button type="button" className="stg-qbtn" disabled={busy} onClick={() => void act([c], "holds")}>Mark complete</button>}
                    {!selected.has(c.edgeId)
                      ? <button type="button" className="stg-qbtn" disabled={busy} onClick={() => toggle(c.edgeId, true)}>Needs update</button>
                      : <button type="button" className="stg-qbtn" disabled={busy} onClick={() => toggle(c.edgeId, false)}>Remove from update queue</button>}
                    {c.kind === "external" && <ScopeOwnerDue child={c} term={term} />}
                    {c.kind === "external" && <ScopeRecipe child={c} suggested={c.check ? null : suggestCheck(c.url ?? "")} />}
                    <span className="cmap-spacer" />
                    {c.kind === "page" && c.slug && <Link href={`/pages/${c.slug}`} className="stg-qbtn" target="_blank">Open page ↗</Link>}
                    {c.kind === "external" && c.url && <a href={c.url} target="_blank" rel="noreferrer" className="stg-qbtn">Open link ↗</a>}
                    {(c.kind === "external" || c.rel === "depends") && <ScopeRemove child={c} term={term} />}
                  </div>
                )}
                {c.note && c.note !== "edited" && <div className="chart-row-note">Note: {c.note}</div>}
                {c.kind === "page" && c.slug ? <PagePreview slug={c.slug} /> : (
                  <div className="chart-ext-body">
                    <a href={c.url ?? "#"} target="_blank" rel="noreferrer" className="stg-dep-link">{c.url}</a>
                    <div className="scope-empty">Outside curata. {(c.check as CheckRecipe | null)?.via ? `An agent can check it via ${(c.check as CheckRecipe).via}.` : "Someone has to open it and look."}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
