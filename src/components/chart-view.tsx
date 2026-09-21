"use client";

import { useState } from "react";
import Link from "next/link";
import type { Chart, ChartNode, ChartNodeDetail } from "@/lib/chart";
import { ChartLeaves } from "@/components/chart-leaves";

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
  if (chart.nodes.length === 0) {
    return (
      <div className="cmap-col-empty chart-empty">
        Nothing here yet. Pick a page that others depend on with &ldquo;Add top level content item&rdquo;, or build a few pages from a template, and it shows up on its own.
      </div>
    );
  }
  return (
    <div className="chart-grid">
      {columns.map((n) => {
        const isOpen = open === n.term;
        return (
          <div key={n.term} className={`chart-card chart-node chart-node--${n.color}${isOpen ? " chart-card--open" : ""}`}>
            <button
              type="button"
              className="chart-card-toggle"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : n.term)}
            >
              <span className="chart-node-title">
                {n.title}
                <span className="chart-card-chevron" aria-hidden>{isOpen ? "▾" : "▸"}</span>
              </span>
              <span className="chart-node-term">{n.term}</span>
              <span className="chart-node-foot">
                <span className="chart-node-kind">{n.kind} · {n.fanOut} under</span>
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
