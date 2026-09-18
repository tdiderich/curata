import Link from "next/link";
import type { ProjectResult, ProjectPageItem, ProjectExternalItem } from "@/lib/projects";
import { relBadge, verifiedCell, noteCell, externalLink, pageLink } from "@/components/dependency-cells";
import { DoneToggle, OwnerDueEditor, RemoveItemButton, AddItemForm, DeleteProjectButton } from "@/components/project-item-controls";

function isPageItem(x: ProjectPageItem | ProjectExternalItem): x is ProjectPageItem {
  return "slug" in x;
}

function OwnItemRow({ term, item }: { term: string; item: ProjectPageItem | ProjectExternalItem }) {
  const overdue = !item.done && item.dueDate && new Date(item.dueDate) < new Date();
  return (
    <tr className={`dash-row${item.done ? " proj-row--done" : ""}`}>
      <td className="dash-td"><DoneToggle term={term} itemId={item.itemId} done={item.done} /></td>
      <td className="dash-td dash-td-title">
        {isPageItem(item) ? pageLink(item) : externalLink(item)}
        {item.doneStale && <span className="proj-done-stale" title="The source changed again after this was marked done">⚠ changed since done</span>}
      </td>
      <td className="dash-td">{relBadge(item.rel)}</td>
      <td className="dash-td">
        <OwnerDueEditor term={term} itemId={item.itemId} owner={item.owner} dueDate={item.dueDate} />
        {overdue && <span className="proj-overdue-tag">overdue</span>}
      </td>
      <td className="dash-td">{verifiedCell(item)}</td>
      <td className="dash-td">{noteCell(item.verifiedNote)}</td>
      <td className="dash-td stg-td-right"><RemoveItemButton term={term} itemId={item.itemId} /></td>
    </tr>
  );
}

function IncludeItemRow({ item }: { item: ProjectPageItem | ProjectExternalItem }) {
  return (
    <tr className="dash-row">
      <td className="dash-td" />
      <td className="dash-td dash-td-title">{isPageItem(item) ? pageLink(item) : externalLink(item)}</td>
      <td className="dash-td">{relBadge(item.rel)}</td>
      <td className="dash-td"><span className="stg-dep-when">shared checklist</span></td>
      <td className="dash-td">{verifiedCell(item)}</td>
      <td className="dash-td">{noteCell(item.verifiedNote)}</td>
      <td className="dash-td" />
    </tr>
  );
}

/** /projects/<term>: header, completion, own items (editable), included sub-maps (read-only here, verify from /map/<term>). */
export function ProjectDetail({ project }: { project: ProjectResult }) {
  const pct = project.completion.total === 0 ? 0 : Math.round((project.completion.done / project.completion.total) * 100);
  return (
    <div className="cmap">
      <header className="cmap-head">
        <div className="cmap-title-row">
          <h1 className="cmap-title">{project.title}</h1>
          <span className="cmap-meta">{project.term}</span>
          <span className="cmap-spacer" />
          <DeleteProjectButton term={project.term} />
        </div>
        <p className="cmap-summary">
          {project.completion.total === 0
            ? "No items yet."
            : `${project.completion.done} of ${project.completion.total} done${project.completion.overdue > 0 ? `, ${project.completion.overdue} overdue` : ""}.`}
        </p>
      </header>

      {project.completion.total > 0 && (
        <div className="proj-bar proj-bar--lg"><span className="proj-bar-fill" style={{ width: `${pct}%` }} /></div>
      )}

      <section className="cmap-step">
        <div className="cmap-filters-label" style={{ marginBottom: 4 }}>Own items</div>
        {project.items.length === 0 ? (
          <div className="dash-empty">Nothing tracked yet.</div>
        ) : (
          <table className="dash-table stg-table">
            <thead>
              <tr>
                <th className="dash-th" style={{ width: "3%" }} />
                <th className="dash-th dash-th-title" style={{ width: "26%" }}>Page / asset</th>
                <th className="dash-th">Rel</th>
                <th className="dash-th">Owner / due</th>
                <th className="dash-th">Last verified</th>
                <th className="dash-th">Note</th>
                <th className="dash-th" />
              </tr>
            </thead>
            <tbody>
              {project.items.map((item) => <OwnItemRow key={item.itemId} term={project.term} item={item} />)}
            </tbody>
          </table>
        )}
        <div style={{ marginTop: 12 }}><AddItemForm term={project.term} /></div>
      </section>

      {project.includes.length > 0 && project.includes.map((inc) => (
        <section key={inc.term} className="cmap-step">
          <div className="cmap-filters-label" style={{ marginBottom: 4 }}>
            From <Link href={`/map/${inc.term}`} className="stg-dep-term">{inc.term}</Link>
            <span className="stg-dep-when"> · shared checklist, verify it from the map, not here</span>
          </div>
          {inc.items.length === 0 ? (
            <div className="dash-empty">Nothing in this checklist.</div>
          ) : (
            <table className="dash-table stg-table">
              <thead>
                <tr>
                  <th className="dash-th" style={{ width: "3%" }} />
                  <th className="dash-th dash-th-title" style={{ width: "26%" }}>Page / asset</th>
                  <th className="dash-th">Rel</th>
                  <th className="dash-th"></th>
                  <th className="dash-th">Last verified</th>
                  <th className="dash-th">Note</th>
                  <th className="dash-th" />
                </tr>
              </thead>
              <tbody>
                {inc.items.map((item, i) => <IncludeItemRow key={`${inc.term}:${i}`} item={item} />)}
              </tbody>
            </table>
          )}
        </section>
      ))}
    </div>
  );
}
