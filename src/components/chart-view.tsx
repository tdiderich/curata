import Link from "next/link";
import type { Chart, ChartNode, ChartNodeDetail } from "@/lib/chart";

export function chartHref(term: string): string {
  return `/map/${term.split("/").map(encodeURIComponent).join("/")}`;
}

export function NodeCard({ node }: { node: ChartNode }) {
  const summary = node.fanOut === 0
    ? "nothing under it"
    : node.color === "green"
      ? "all checked"
      : [node.counts.red ? `${node.counts.red} red` : null, node.counts.yellow ? `${node.counts.yellow} yellow` : null].filter(Boolean).join(" · ");
  return (
    <Link href={chartHref(node.term)} className={`chart-node chart-node--${node.color}`}>
      <span className="chart-node-title">{node.title}</span>
      <span className="chart-node-term">{node.term}</span>
      <span className="chart-node-foot">
        <span className="chart-node-kind">{node.kind} · {node.fanOut} under</span>
        <span className={`chart-node-summary chart-text--${node.color}`}>{summary}</span>
      </span>
    </Link>
  );
}

export function ChartView({ chart, columns }: { chart: Chart; columns: ChartNodeDetail[] }) {
  if (chart.nodes.length === 0) {
    return (
      <div className="cmap-col-empty chart-empty">
        Nothing here yet. Pick a page that others depend on with &ldquo;Add top level content item&rdquo;, or build a few pages from a template, and it shows up on its own.
      </div>
    );
  }
  return (
    <div className="chart-org">
      {columns.map((n) => (
        <div key={n.term} className="chart-col">
          <NodeCard node={n} />
          {n.children.length > 0 && <div className="chart-stem" />}
          <ul className="chart-leaves">
            {n.children.map((c) => (
              <li key={c.edgeId} className={`chart-leaf chart-leaf--${c.color}`}>
                <span className={`chart-dot chart-dot--${c.color}`} />
                {c.kind === "page" && c.slug
                  ? <Link href={`/pages/${c.slug}`} className="chart-leaf-label" title={c.reason ?? ""}>{c.label}</Link>
                  : <a href={c.url ?? "#"} target="_blank" rel="noreferrer" className="chart-leaf-label" title={`${c.host ?? ""}${c.reason ? ` · ${c.reason}` : ""}`}>{c.label}</a>}
                {c.kind === "external" && <span className="chart-leaf-ext" aria-label="external">↗</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
