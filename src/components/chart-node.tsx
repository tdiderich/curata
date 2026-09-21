import Link from "next/link";
import type { ChartChild, ChartNodeDetail as ChartNodeDetailData } from "@/lib/chart";
import { relativeTime } from "@/components/dependency-cells";
import { SettingsSection, SettingsTable } from "@/components/settings";
import { ChartCheckButton, ChartNodeToggle } from "@/components/chart-controls";
import { AddRelatedButton, ScopeOwnerDue, ScopePanel, ScopeRecipe, ScopeRemove } from "@/components/chart-scope";
import { suggestCheck } from "@/lib/scope";
import { chartHref } from "@/components/chart-view";

function relLabel(c: ChartChild): string {
  if (c.kind === "external") return `external · ${c.host ?? ""}`;
  if (c.rel === "embeds") return "embeds this";
  if (c.rel === "instantiates") return "built from this";
  return "depends on this";
}

function checkedCell(c: ChartChild) {
  if (c.color === "green") {
    return <span className="chart-text--green">{c.lastCheckedAt ? relativeTime(c.lastCheckedAt) : "nothing to drift against"}</span>;
  }
  return (
    <span className={`chart-text--${c.color}`}>
      {c.lastCheckedAt ? `${relativeTime(c.lastCheckedAt)} · ` : ""}{c.reason}
    </span>
  );
}

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
        <SettingsTable
          head={
            <>
              <th className="dash-th dash-th-title" style={{ width: "46%" }}>Content</th>
              <th className="dash-th">Owner · due</th>
              <th className="dash-th">Last checked</th>
              {canEdit && <th className="dash-th stg-th-right">&nbsp;</th>}
            </>
          }
          empty={node.children.length === 0 ? `Nothing under this yet.${canEdit ? " Use Add related content above." : ""}` : undefined}
        >
          {node.children.map((c) => (
            <tr key={c.edgeId} className="dash-row">
              <td className="dash-td dash-td-title">
                <div className="chart-cell-main">
                  <span className={`chart-dot chart-dot--${c.color}`} />
                  <div className="chart-cell-text">
                    {c.kind === "page" && c.slug
                      ? <Link href={`/pages/${c.slug}`} className="stg-dep-link">{c.label}</Link>
                      : <a href={c.url ?? "#"} target="_blank" rel="noreferrer" className="stg-dep-link">{c.label}</a>}
                    <span className="stg-pcount">
                      {relLabel(c)}
                      {c.alsoUnder.length > 0 && <> · also under {c.alsoUnder.map((t, i) => <span key={t}>{i > 0 && ", "}<Link href={chartHref(t)} className="chart-also-link">{t}</Link></span>)}</>}
                    </span>
                    {c.kind === "external" && canEdit && <ScopeRecipe child={c} suggested={c.check ? null : suggestCheck(c.url ?? "")} />}
                  </div>
                </div>
              </td>
              <td className="dash-td">
                {c.kind === "external" && canEdit
                  ? <ScopeOwnerDue child={c} term={node.term} />
                  : <span className="stg-dep-when">{c.owner ?? "—"}{c.dueAt ? ` · ${c.dueAt.slice(0, 10)}` : ""}</span>}
              </td>
              <td className="dash-td">{checkedCell(c)}</td>
              {canEdit && (
                <td className="dash-td stg-td-right">
                  <span className="chart-actions">
                    {c.color !== "green" && <ChartCheckButton child={c} term={node.term} />}
                    {(c.kind === "external" || c.rel === "depends") && <ScopeRemove child={c} term={node.term} />}
                  </span>
                </td>
              )}
            </tr>
          ))}
        </SettingsTable>
      </SettingsSection>
    </div>
  );
}
