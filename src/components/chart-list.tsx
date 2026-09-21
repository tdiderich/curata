import Link from "next/link";
import type { ChartNodeDetail } from "@/lib/chart";
import { relativeTime } from "@/components/dependency-cells";
import { chartHref } from "@/components/chart-view";
import { ChartCheckButton } from "@/components/chart-controls";

export function ChartList({ nodes }: { nodes: ChartNodeDetail[] }) {
  if (nodes.length === 0) return <div className="cmap-col-empty">Everything under every node has been checked since it last moved.</div>;
  return (
    <div className="chart-list">
      {nodes.map((n) => (
        <section key={n.term} className="chart-group">
          <div className="chart-group-head">
            <span><Link href={chartHref(n.term)} className="chart-group-title">{n.title}</Link> <span className="chart-node-term">{n.term}</span></span>
            <span className="chart-group-meta">
              {n.source ? `changed ${relativeTime(n.source.updatedAt)}${n.source.updatedBy ? ` by ${n.source.updatedBy}` : ""}` : "no source page"}
              {" · "}{n.counts.red ? `${n.counts.red} red · ` : ""}{n.counts.yellow} yellow
            </span>
          </div>
          {n.children.map((c) => (
            <div key={c.edgeId} className="chart-li">
              <span className={`chart-dot chart-dot--${c.color}`} />
              <span className="chart-li-label">
                {c.kind === "page" && c.slug ? <Link href={`/pages/${c.slug}`}>{c.label}</Link> : <a href={c.url ?? "#"} target="_blank" rel="noreferrer">{c.label}</a>}
                <span className="chart-child-kind"> {c.kind === "external" ? `external${c.alsoUnder.length ? ` · also under ${c.alsoUnder.join(", ")}` : ""}` : c.alsoUnder.length ? `also under ${c.alsoUnder.join(", ")}` : c.rel}</span>
              </span>
              <span className="chart-li-owner">{c.owner ?? "—"}{c.dueAt ? ` · due ${new Date(c.dueAt).toLocaleDateString()}` : ""}</span>
              <span className={`chart-text--${c.color}`}>{c.reason}</span>
              <span className="chart-li-action"><ChartCheckButton child={c} term={n.term} /></span>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
