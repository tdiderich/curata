import Link from "next/link";
import type { ChartChild, ChartNodeDetail as ChartNodeDetailData } from "@/lib/chart";
import { relativeTime } from "@/components/dependency-cells";
import { SettingsSection, SettingsTable } from "@/components/settings";
import { ChartCheckButton, ChartNodeToggle } from "@/components/chart-controls";
import { ScopeOwnerDue, ScopePanel, ScopeRecipe, ScopeRemove } from "@/components/chart-scope";
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
  const desc = node.source
    ? <>Source <Link href={`/pages/${node.source.slug}`} className="stg-dep-link">{node.source.title}</Link>, changed {relativeTime(node.source.updatedAt)}{node.source.updatedBy ? ` by ${node.source.updatedBy}` : ""}. Change it and everything below needs a look.</>
    : <>No source page yet. Nothing here can drift until a page asserts <code>{node.term}</code>.</>;

  return (
    <div className="cmap">
      <header className="cmap-head">
        <div className="cmap-title-row">
          <span className={`chart-dot chart-dot--${node.color} chart-dot--lg`} />
          <h1 className="cmap-title">{node.title}</h1>
          <span className="chart-node-term">{node.term}</span>
          <span className="cmap-spacer" />
          {canEdit && (
            <>
              <ChartNodeToggle term={node.term} field="pinned" value={node.pinned} onLabel="Unpin" offLabel="Pin to top" />
              <ChartNodeToggle term={node.term} field="hidden" value={node.hidden} onLabel="Unhide" offLabel="Hide" />
            </>
          )}
        </div>
      </header>

      <div className="chart-body">
        <div className="chart-body-main">
          <SettingsSection title={`Under it · ${node.fanOut}`} description={desc}>
            <SettingsTable
              head={
                <>
                  <th className="dash-th dash-th-title" style={{ width: "44%" }}>Content</th>
                  <th className="dash-th">Owner · due</th>
                  <th className="dash-th">Last checked</th>
                  {canEdit && <th className="dash-th stg-th-right">&nbsp;</th>}
                </>
              }
              empty={node.children.length === 0 ? `Nothing under this yet.${canEdit ? " Add related content on the right." : ""}` : undefined}
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
        {canEdit && <ScopePanel term={node.term} />}
      </div>
    </div>
  );
}
