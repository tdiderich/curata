"use client";

import { useState } from "react";
import Link from "next/link";
import type { Chart, ChartNode, ChartNodeDetail } from "@/lib/chart";
import { ChartLeaves } from "@/components/chart-leaves";
import { buildMapPrompt } from "@/lib/chart-prompt";
import { basePath } from "@/lib/api-fetch";
import { toast } from "@/components/toast";

export function chartHref(term: string): string {
  return `/map/${term.split("/").map(encodeURIComponent).join("/")}`;
}

function summaryFor(node: ChartNode): string {
  if (node.fanOut === 0) return "nothing under it";
  if (node.color === "green") return "all checked";
  return [node.counts.red ? `${node.counts.red} red` : null, node.counts.yellow ? `${node.counts.yellow} yellow` : null].filter(Boolean).join(" · ");
}

/** A node as a link card (page settings, list view headers). */
export function NodeCard({ node }: { node: ChartNode }) {
  return (
    <Link href={chartHref(node.term)} className={`chart-node chart-node--${node.color}`}>
      <span className="chart-node-title">{node.title}</span>
      <span className="chart-node-term">{node.term}</span>
      <span className="chart-node-foot">
        <span className="chart-node-kind">{node.kind} · {node.fanOut} under</span>
        <span className={`chart-node-summary chart-text--${node.color}`}>{summaryFor(node)}</span>
      </span>
    </Link>
  );
}

/**
 * The map: node cards in a wrapping grid, worst-first. Click a card and it
 * opens in place across the row with what sits under it; click again to
 * fold. The node page (full rows, prompts, add related content) is the
 * "Open" link on the open card, so a click here never navigates by accident.
 */
export function ChartView({ chart, columns }: { chart: Chart; columns: ChartNodeDetail[] }) {
  const [open, setOpen] = useState<string | null>(null);
  // The open card leads; everything else keeps the map's attention-first order.
  const ordered = open ? [...columns.filter((n) => n.term === open), ...columns.filter((n) => n.term !== open)] : columns;
  if (chart.nodes.length === 0) {
    return (
      <div className="cmap-col-empty chart-empty">
        Nothing here yet. Pick a page that others depend on with &ldquo;Add top level content item&rdquo;, or build a few pages from a template, and it shows up on its own.
      </div>
    );
  }
  return (
    <div className="chart-grid">
      {ordered.map((n) => {
        const isOpen = open === n.term;
        return (
          <div key={n.term} className={`chart-card chart-node chart-node--${n.color}${isOpen ? " chart-card--open" : ""}${n.hidden ? " chart-card--hidden" : ""}`}>
            <button
              type="button"
              className="chart-card-toggle"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : n.term)}
            >
              <span className="chart-node-title">
                {n.title}
                {n.hidden && <span className="chart-card-tag">hidden</span>}
                <span className="chart-card-chevron" aria-hidden>{isOpen ? "▾" : "▸"}</span>
              </span>
              <span className="chart-node-term">{n.term}</span>
              <span className="chart-node-foot">
                <span className="chart-node-kind">{n.kind} · {n.fanOut} under{n.source?.status ? <> · <span className={`chart-card-status chart-card-status--${n.group}`}>{n.source.status}</span></> : null}</span>
                <span className={`chart-node-summary chart-text--${n.color}`}>{summaryFor(n)}</span>
              </span>
            </button>
            {isOpen && (
              <div className="chart-card-body">
                <div className="chart-card-actions">
                  {n.source && <span className="chart-card-source">Source: <Link href={`/pages/${n.source.slug}`}>{n.source.title}</Link></span>}
                  <Link href={chartHref(n.term)} className="btn btn--ghost">Open</Link>
                </div>
                {n.children.length > 0
                  ? <ChartLeaves grid>{n.children}</ChartLeaves>
                  : <div className="scope-empty">Nothing under this yet.</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Title-row button: one brief for everything yellow or red across every node. Hidden when nothing needs attention. */
export function ChartCopyAll({ columns }: { columns: ChartNodeDetail[] }) {
  const attention = columns.map((n) => ({ ...n, items: n.children.filter((c) => c.color !== "green") })).filter((n) => n.items.length > 0);
  const count = attention.reduce((sum, n) => sum + n.items.length, 0);
  if (count === 0) return null;
  async function copyAll() {
    const baseUrl = `${window.location.origin}${basePath}`;
    try {
      await navigator.clipboard.writeText(buildMapPrompt(attention, baseUrl));
      toast.success(`Prompt for ${count} item${count === 1 ? "" : "s"} across ${attention.length} node${attention.length === 1 ? "" : "s"} on your clipboard.`);
    } catch { toast.error("Couldn't copy to the clipboard."); }
  }
  return <button type="button" className="btn btn--ghost" onClick={() => void copyAll()} title={`${count} item${count === 1 ? "" : "s"} across ${attention.length} node${attention.length === 1 ? "" : "s"}`}>Copy prompt for all {count}</button>;
}
