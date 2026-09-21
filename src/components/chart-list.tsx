import Link from "next/link";
import type { ChartChild, ChartNodeDetail } from "@/lib/chart";
import { relativeTime } from "@/components/dependency-cells";
import { chartHref } from "@/components/chart-view";
import { ChartCheckButton } from "@/components/chart-controls";

function relLabel(c: ChartChild): string {
  if (c.kind === "external") return `external · ${c.host ?? ""}`;
  if (c.rel === "embeds") return "embeds this";
  if (c.rel === "instantiates") return "built from this";
  return "depends on this";
}

/** The map as a list: yellow and red only, grouped by node, same row grid as a node page. */
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
          <div className="chart-rows chart-rows--list">
            <div className="chart-rows-head chart-row-line--list"><span>Content</span><span>Owner · due</span><span>Last checked</span><span /></div>
            {n.children.map((c) => (
              <div key={c.edgeId} className="chart-row">
                <div className="chart-row-line chart-row-line--list">
                  <span className="chart-cell-text">
                    <span className="chart-row-title">
                      {c.kind === "page" && c.slug ? <Link href={chartHref(n.term)} className="chart-row-link">{c.label}</Link> : <a href={c.url ?? "#"} target="_blank" rel="noreferrer" className="chart-row-link">{c.label}</a>}
                    </span>
                    <span className="stg-pcount">
                      {relLabel(c)}
                      {c.alsoUnder.length > 0 && <> · also under {c.alsoUnder.map((t, i) => <span key={t}>{i > 0 && ", "}<Link href={chartHref(t)} className="chart-also-link">{t}</Link></span>)}</>}
                    </span>
                  </span>
                  <span className="stg-dep-when">{c.owner ?? "—"}{c.dueAt ? ` · ${c.dueAt.slice(0, 10)}` : ""}</span>
                  <span className={`chart-text--${c.color}`}>{c.lastCheckedAt ? `${relativeTime(c.lastCheckedAt)} · ` : ""}{c.reason}</span>
                  <span className="chart-td-action"><ChartCheckButton child={c} term={n.term} /></span>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
