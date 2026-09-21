import Link from "next/link";
import type { ChartNodeDetail as ChartNodeDetailData } from "@/lib/chart";
import { relativeTime } from "@/components/dependency-cells";
import { ChartCheckButton, ChartNodeToggle } from "@/components/chart-controls";

export function ChartNodeDetail({ node, canEdit }: { node: ChartNodeDetailData; canEdit: boolean }) {
  return (
    <div className="cmap">
      <header className="cmap-head">
        <div className="cmap-title-row">
          <span className={`chart-dot chart-dot--${node.color} chart-dot--lg`} />
          <h1 className="cmap-title">{node.title}</h1>
          <span className="cmap-spacer" />
          {canEdit && (
            <>
              <ChartNodeToggle term={node.term} field="pinned" value={node.pinned} onLabel="Unpin" offLabel="Pin to top" />
              <ChartNodeToggle term={node.term} field="hidden" value={node.hidden} onLabel="Unhide" offLabel="Hide" />
            </>
          )}
        </div>
        <p className="cmap-meta">
          <span className="chart-node-term">{node.term}</span>
          {node.source && <> · source <Link href={`/pages/${node.source.slug}`}>{node.source.title}</Link> · changed {relativeTime(node.source.updatedAt)}{node.source.updatedBy ? ` by ${node.source.updatedBy}` : ""}</>}
          {!node.source && <> · no source page. Nothing here can drift until one asserts this.</>}
        </p>
      </header>

      {node.children.length === 0 ? (
        <div className="cmap-col-empty">Nothing under this yet.</div>
      ) : (
        <div className="chart-table">
          <div className="chart-tr chart-tr--head">
            <span /><span>Report</span><span>Owner · due</span><span>Last checked</span><span />
          </div>
          {node.children.map((c) => (
            <div key={c.edgeId} className="chart-tr">
              <span className={`chart-dot chart-dot--${c.color}`} />
              <span className="chart-td-main">
                {c.kind === "page" && c.slug ? <Link href={`/pages/${c.slug}`} className="chart-child-label">{c.label}</Link> : <a href={c.url ?? "#"} target="_blank" rel="noreferrer" className="chart-child-label">{c.label}</a>}
                <span className="chart-child-kind">
                  {c.kind === "external" ? `external · ${c.host ?? ""}` : c.rel === "embeds" ? "embeds this" : c.rel === "instantiates" ? "built from this" : "depends on this"}
                  {c.alsoUnder.length > 0 && ` · also under ${c.alsoUnder.join(", ")}`}
                </span>
              </span>
              <span className="chart-td-muted">{c.owner ?? "—"}{c.dueAt ? ` · ${new Date(c.dueAt).toLocaleDateString()}` : ""}</span>
              <span className={`chart-text--${c.color}`}>
                {c.color !== "green" && c.reason
                  ? (c.lastCheckedAt ? `${relativeTime(c.lastCheckedAt)} · ${c.reason}` : c.reason)
                  : (c.lastCheckedAt ? relativeTime(c.lastCheckedAt) : "nothing to drift against")}
              </span>
              <span className="chart-td-action">{canEdit && c.color !== "green" ? <ChartCheckButton child={c} term={node.term} /> : c.color === "green" ? <span className="chart-td-muted">✓</span> : null}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
