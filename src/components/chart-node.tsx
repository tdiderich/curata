import type { ChartNodeDetail as ChartNodeDetailData } from "@/lib/chart";
import { relativeTime } from "@/components/dependency-cells";
import { NodeMenu } from "@/components/chart-controls";
import { AddRelatedButton, ScopePanel } from "@/components/chart-scope";
import { ChartRows } from "@/components/chart-rows";

export function ChartNodeDetail({ node, canEdit }: { node: ChartNodeDetailData; canEdit: boolean }) {
  const attention = node.counts.red + node.counts.yellow;
  return (
    <div className="cmap">
      <header className="cmap-head">
        <div className="cmap-title-row">
          <span className={`chart-dot chart-dot--${node.color} chart-dot--lg`} />
          <h1 className="cmap-title">{node.title}</h1>
          <span className="cmap-spacer" />
          <NodeMenu term={node.term} source={node.source} instructions={node.instructions} hidden={node.hidden} canEdit={canEdit} />
          {canEdit && <AddRelatedButton />}
        </div>
        {node.instructions && <p className="cmap-instr-line">{node.instructions}</p>}
      </header>

      {canEdit && <ScopePanel term={node.term} />}
      <ChartRows
        rows={node.children}
        term={node.term}
        canEdit={canEdit}
        source={node.source}
        instructions={node.instructions}
        header={(
          <div className="cmap-stats">
            <div className={`cmap-stat${attention > 0 ? " cmap-stat--warn" : ""}`}>
              <span className="cmap-stat-label">Needs update</span>
              <span className="cmap-stat-value">{attention}</span>
              <span className="cmap-stat-sub">{node.counts.red > 0 ? <span className="chart-text--red">{node.counts.red} red</span> : null}{node.counts.red > 0 && node.counts.yellow > 0 ? " · " : ""}{node.counts.yellow > 0 ? <span className="chart-text--yellow">{node.counts.yellow} yellow</span> : null}{attention === 0 ? "everything checked" : ""}</span>
            </div>
            <div className="cmap-stat">
              <span className="cmap-stat-label">Checked</span>
              <span className="cmap-stat-value">{node.counts.green}</span>
              <span className="cmap-stat-sub">of {node.fanOut} under this</span>
            </div>
            <div className={`cmap-stat${node.source ? "" : " cmap-stat--gap"}`}>
              <span className="cmap-stat-label">Source changed</span>
              <span className="cmap-stat-value cmap-stat-value--text">{node.source ? relativeTime(node.source.updatedAt) : "no source"}</span>
              <span className="cmap-stat-sub">{node.source ? `${node.source.title}${node.source.updatedBy ? ` · ${node.source.updatedBy}` : ""}` : "nothing here can drift until a page owns the truth"}</span>
            </div>
          </div>
        )}
      />
    </div>
  );
}
