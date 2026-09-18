import Link from "next/link";
import type { ConceptMapRow } from "@/lib/concepts";
import { StatusBadge } from "@/components/settings/status-badge";
import { relativeTime } from "@/components/dependency-cells";

/** Segmented bar: verified / needs update / source changed / never checked. */
export function CoverageBar({ row }: { row: ConceptMapRow }) {
  const p = row.summary.pages, e = row.summary.external;
  const segs: Array<[number, string]> = [
    [p.ok + e.ok, "ok"],
    [p.needsChange + e.needsChange, "needs-change"],
    [p.stale + e.stale, "stale"],
    [p.neverVerified + e.neverChecked, "never"],
  ];
  if (row.total === 0) return <div className="cmap-bar cmap-bar--empty" />;
  return (
    <div className="cmap-bar" aria-hidden>
      {segs.filter(([n]) => n > 0).map(([n, tone]) => (
        <span key={tone} className={`cmap-bar-seg cmap-bar-seg--${tone}`} style={{ flexGrow: n }} />
      ))}
    </div>
  );
}

export function flagBadges(row: ConceptMapRow) {
  const p = row.summary.pages, e = row.summary.external;
  const out = [];
  if (p.needsChange + e.needsChange) out.push(<StatusBadge key="nc" tone="needs-change" label={`${p.needsChange + e.needsChange} needs update`} />);
  if (p.stale + e.stale) out.push(<StatusBadge key="st" tone="behind" label={`${p.stale + e.stale} source changed`} />);
  if (p.neverVerified + e.neverChecked) out.push(<StatusBadge key="nv" tone="untrusted" label={`${p.neverVerified + e.neverChecked} never checked`} />);
  return out;
}

/**
 * /map: every concept something depends on, ranked by how much still needs
 * a human. Where a lead starts when they know the change but not the page.
 */
export function ConceptMapIndex({ rows }: { rows: ConceptMapRow[] }) {
  const totalLook = rows.reduce((n, r) => n + r.needsLook, 0);
  return (
    <div className="cmap">
      <header className="cmap-head">
        <h1 className="cmap-title">Map</h1>
        <p className="cmap-summary">
          {rows.length === 0
            ? "No dependency graphs yet. Tag pages with rel depends / asserts, or call map_dependencies."
            : `${totalLook} thing${totalLook === 1 ? "" : "s"} across ${rows.length} concept${rows.length === 1 ? "" : "s"} still need a look since their source moved.`}
        </p>
      </header>
      {rows.length > 0 && (
        <table className="dash-table stg-table">
          <thead>
            <tr>
              <th className="dash-th dash-th-title" style={{ width: "36%" }}>Concept</th>
              <th className="dash-th">Kind</th>
              <th className="dash-th" style={{ width: "26%" }}>Checked</th>
              <th className="dash-th">Flags</th>
              <th className="dash-th" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.term} className="dash-row">
                <td className="dash-td dash-td-title">
                  <div className="cmap-row-term">
                    <Link href={`/map/${r.term}`} className="stg-dep-term">{r.term}</Link>
                    <span className="cmap-row-source">
                      {r.sources[0]
                        ? <>source: {r.sources[0].title} · updated {relativeTime(r.sources[0].updatedAt)}</>
                        : "no source of truth"}
                    </span>
                  </div>
                </td>
                <td className="dash-td">{r.kind ? <StatusBadge tone="template" label={r.kind} /> : null}</td>
                <td className="dash-td">
                  <div className="cmap-row-cov">
                    <CoverageBar row={r} />
                    <span className="cmap-row-stat">
                      {r.total === 0
                        ? <span className="stg-dep-when">nothing depends on this yet</span>
                        : <><strong>{r.needsLook}</strong> <span className="stg-dep-when">of {r.total} need a look</span></>}
                    </span>
                  </div>
                </td>
                <td className="dash-td"><div className="cmap-row-flags">{flagBadges(r)}</div></td>
                <td className="dash-td cmap-row-go"><Link href={`/map/${r.term}`} aria-label={`Open ${r.term}`}>→</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
