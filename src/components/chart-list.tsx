import Link from "next/link";
import type { ChartNodeDetail } from "@/lib/chart";
import { relativeTime } from "@/components/dependency-cells";
import { chartHref } from "@/components/chart-view";
import { ChartRows } from "@/components/chart-rows";

/**
 * The map as a list: every node with something yellow or red, each with the
 * same rows a node page has. Expand to review inline, check to queue, copy
 * a prompt, mark complete. Nothing links away.
 */
export function ChartList({ nodes, canEdit }: { nodes: ChartNodeDetail[]; canEdit: boolean }) {
  if (nodes.length === 0) return <div className="cmap-col-empty">Everything under every node has been checked since it last moved.</div>;
  return (
    <div className="chart-list">
      {nodes.map((n) => (
        <section key={n.term} className="chart-group">
          <div className="chart-group-head">
            <span><Link href={chartHref(n.term)} className="chart-group-title">{n.title}</Link> <span className="chart-node-term">{n.term}</span></span>
            <span className="chart-group-meta">
              {n.source ? `source changed ${relativeTime(n.source.updatedAt)}${n.source.updatedBy ? ` by ${n.source.updatedBy}` : ""}` : "no source page"}
              {" · "}{n.counts.red ? `${n.counts.red} red · ` : ""}{n.counts.yellow} yellow
            </span>
          </div>
          <ChartRows rows={n.children} term={n.term} canEdit={canEdit} source={n.source} instructions={n.instructions} />
        </section>
      ))}
    </div>
  );
}
