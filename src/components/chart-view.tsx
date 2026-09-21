import Link from "next/link";
import type { Chart, ChartChild, ChartNode, ChartNodeDetail } from "@/lib/chart";
import { relativeTime } from "@/components/dependency-cells";

export function chartHref(term: string): string {
  return `/chart/${term.split("/").map(encodeURIComponent).join("/")}`;
}

export function NodeCard({ node }: { node: ChartNode }) {
  const summary = node.fanOut === 0
    ? "nothing under it"
    : node.color === "green"
      ? "all checked"
      : [node.counts.red ? `${node.counts.red} red` : null, node.counts.yellow ? `${node.counts.yellow} yellow` : null].filter(Boolean).join(" · ");
  return (
    <Link href={chartHref(node.term)} className={`chart-node chart-node--${node.color}`}>
      <span className="chart-node-title">{node.title}{node.pinned && <span className="chart-pin" title="Pinned">●</span>}</span>
      <span className="chart-node-term">{node.term}</span>
      <span className="chart-node-foot">
        <span className="chart-node-kind">{node.kind} · {node.fanOut} under</span>
        <span className={`chart-node-summary chart-text--${node.color}`}>{summary}</span>
      </span>
    </Link>
  );
}

export function ChildCard({ child }: { child: ChartChild }) {
  const state = child.color === "green"
    ? child.lastCheckedAt ? `Checked ${relativeTime(child.lastCheckedAt)}` : "Nothing to drift against"
    : child.reason ?? "Needs a look";
  return (
    <div className={`chart-child chart-child--${child.color}`}>
      <div className="chart-child-top">
        {child.kind === "page" && child.slug
          ? <Link href={`/pages/${child.slug}`} className="chart-child-label">{child.label}</Link>
          : <a href={child.url ?? "#"} target="_blank" rel="noreferrer" className="chart-child-label">{child.label}</a>}
        <span className="chart-child-kind">{child.kind === "external" ? `external · ${child.host ?? ""}` : child.rel === "embeds" ? "embeds" : child.rel === "instantiates" ? "built from" : "page"}</span>
      </div>
      <div className={`chart-text--${child.color}`}>{state}{child.owner ? ` · ${child.owner}` : ""}</div>
      {child.alsoUnder.length > 0 && <div className="chart-child-also">also under {child.alsoUnder.join(", ")}</div>}
    </div>
  );
}

export function ChartView({ chart, expanded }: { chart: Chart; expanded: ChartNodeDetail | null }) {
  if (chart.nodes.length === 0) {
    return (
      <div className="cmap-col-empty chart-empty">
        Nothing here yet. Pick a page that others depend on with &ldquo;Add to chart&rdquo;, or build a few pages from a template, and it shows up on its own.
      </div>
    );
  }
  return (
    <>
      <div className="chart-row">
        {chart.nodes.map((n) => <NodeCard key={n.term} node={n} />)}
      </div>
      {expanded && (
        <section className="chart-expanded">
          <div className="chart-expanded-head">
            Under <Link href={chartHref(expanded.term)} className="chart-node-term">{expanded.term}</Link>
            {expanded.source && <> · changed {relativeTime(expanded.source.updatedAt)}{expanded.source.updatedBy ? ` by ${expanded.source.updatedBy}` : ""}</>}
            {" · "}{expanded.fanOut} under
          </div>
          <div className="chart-grid">
            {expanded.children.map((c) => <ChildCard key={c.edgeId} child={c} />)}
          </div>
        </section>
      )}
    </>
  );
}
