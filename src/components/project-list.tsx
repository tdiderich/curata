import Link from "next/link";
import type { ProjectSummary } from "@/lib/projects";
import { relativeTime } from "@/components/dependency-cells";

/** /projects: every run currently tracked, newest first. */
export function ProjectList({ projects }: { projects: ProjectSummary[] }) {
  return (
    <div className="cmap">
      <header className="cmap-head">
        <div className="cmap-title-row">
          <h1 className="cmap-title">Projects</h1>
          <span className="cmap-spacer" />
          <Link href="/projects/new" className="btn btn--primary">New project</Link>
        </div>
        <p className="cmap-summary">
          {projects.length === 0
            ? "No projects yet. Clone a map to start tracking one to completion."
            : `${projects.length} project${projects.length === 1 ? "" : "s"} tracked.`}
        </p>
      </header>
      {projects.length > 0 && (
        <table className="dash-table stg-table">
          <thead>
            <tr>
              <th className="dash-th dash-th-title" style={{ width: "36%" }}>Project</th>
              <th className="dash-th">Cloned from</th>
              <th className="dash-th" style={{ width: "26%" }}>Done</th>
              <th className="dash-th">Started</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.term} className="dash-row">
                <td className="dash-td dash-td-title">
                  <div className="cmap-row-term">
                    <Link href={`/projects/${p.term}`} className="stg-dep-link">{p.title}</Link>
                    <span className="cmap-row-source">{p.term}</span>
                  </div>
                </td>
                <td className="dash-td">
                  {p.clonedFrom ? <Link href={`/map/${p.clonedFrom}`} className="stg-dep-term">{p.clonedFrom}</Link> : <span className="stg-dep-when">blank</span>}
                </td>
                <td className="dash-td">
                  {p.completion.total === 0 ? (
                    <span className="stg-dep-when">no items yet</span>
                  ) : (
                    <div className="proj-bar-row">
                      <div className="proj-bar"><span className="proj-bar-fill" style={{ width: `${(p.completion.done / p.completion.total) * 100}%` }} /></div>
                      <span className="proj-bar-stat">{p.completion.done} / {p.completion.total}{p.completion.overdue > 0 && <span className="proj-overdue"> · {p.completion.overdue} overdue</span>}</span>
                    </div>
                  )}
                </td>
                <td className="dash-td"><span className="stg-dep-when">{relativeTime(p.createdAt)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
