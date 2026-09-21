import Link from "next/link";
import type { ChartNodeDetail as ChartNodeDetailData } from "@/lib/chart";
import { relativeTime } from "@/components/dependency-cells";
import { SettingsSection } from "@/components/settings";
import { ChartNodeToggle } from "@/components/chart-controls";
import { AddRelatedButton, ScopePanel } from "@/components/chart-scope";
import { ChartRows } from "@/components/chart-rows";

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
              <ChartNodeToggle term={node.term} field="hidden" value={node.hidden} onLabel="Show on content map" offLabel="Hide from content map" />
              <AddRelatedButton />
            </>
          )}
        </div>
        <p className="cmap-meta"><span className="chart-node-term">{node.term}</span></p>
      </header>

      <div className={`cmap-source${node.source ? "" : " cmap-source--gap"}`}>
        <span className="cmap-source-label">Source of truth</span>
        {node.source ? (
          <>
            <span className="cmap-source-item">
              <Link href={`/pages/${node.source.slug}`} className="stg-dep-link">{node.source.title}</Link>
              <span className="stg-dep-when">changed {relativeTime(node.source.updatedAt)}{node.source.updatedBy ? ` by ${node.source.updatedBy}` : ""}</span>
            </span>
            <span className="cmap-source-hint">When this page changes, everything below needs a look.</span>
          </>
        ) : (
          <span className="cmap-source-hint">No page owns the truth for <code>{node.term}</code> yet. Nothing here can drift until one does.</span>
        )}
      </div>

      <SettingsSection title="Related content">
        {canEdit && <ScopePanel term={node.term} />}
        {node.children.length === 0
          ? <div className="dash-empty stg-table">Nothing under this yet.{canEdit ? " Use Add related content above." : ""}</div>
          : <ChartRows rows={node.children} term={node.term} canEdit={canEdit} source={node.source} />}
      </SettingsSection>
    </div>
  );
}
