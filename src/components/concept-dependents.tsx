import Link from "next/link";
import type { DependentsResult, DependentPage, ExternalDependentRow } from "@/lib/concepts";
import { DependencyVerifyButton } from "@/components/dependency-verify-button";
import { StatusBadge } from "@/components/settings/status-badge";
import {
  relBadge, verifiedCell, noteCell, externalLink, pageLink, relativeTime, verifyState, VERIFY_STATE_LABEL, termLink,
  type VerifyState,
} from "@/components/dependency-cells";

export type ConceptView = "table" | "board";
export type ConceptFilter = "all" | "look" | "needs-change" | "ok";

type Row =
  | { kind: "page"; state: VerifyState; d: DependentPage }
  | { kind: "external"; state: VerifyState; e: ExternalDependentRow };

function rowsOf(data: DependentsResult): Row[] {
  const pages: Row[] = [...data.dependents, ...data.instances].map((d) => ({ kind: "page", state: verifyState(d), d }));
  const ext: Row[] = data.external.map((e) => ({ kind: "external", state: verifyState(e), e }));
  return [...pages, ...ext];
}

function matches(r: Row, f: ConceptFilter) {
  if (f === "all") return true;
  if (f === "ok") return r.state === "ok";
  if (f === "needs-change") return r.state === "needs-change";
  return r.state !== "ok";
}

// context = the map currently being viewed. verifyDependent collapses
// context into a no-op (writes the base fields) when it equals the edge's
// own concept, which is exactly the case for every row that was not pulled
// in through an include - so it's always safe to pass, and it's the one
// thing that keeps a shared sub-map's check from bleeding into another map.
function verifyButton(r: Row, term: string) {
  const label = r.state === "ok" ? "Re-verify" : "Verify";
  return r.kind === "page"
    ? <DependencyVerifyButton slug={r.d.slug} term={r.d.via} context={term} label={label} />
    : <DependencyVerifyButton url={r.e.url} term={r.e.via} context={term} label={label} />;
}

function groupTag(group: string | undefined) {
  if (!group) return null;
  return <Link href={`/map/${group}`} className="cmap-group-tag" title={`Included from ${group}`}>{group}</Link>;
}

/**
 * /map/<term>: the concept's whole dependency picture on one URL. Header,
 * source-of-truth banner, filter chips, then the rows as a table (dense,
 * mirrors the settings tab) or a board (one column per verification state,
 * work left to right). Server-rendered; the Verify buttons are the only
 * client islands.
 */
export function ConceptDependents({ data, term, view, filter }: { data: DependentsResult; term: string; view: ConceptView; filter: ConceptFilter }) {
  const rows = rowsOf(data);
  const counts = {
    all: rows.length,
    look: rows.filter((r) => r.state !== "ok").length,
    "needs-change": rows.filter((r) => r.state === "needs-change").length,
    ok: rows.filter((r) => r.state === "ok").length,
  };
  const visible = rows.filter((r) => matches(r, filter));
  const href = (v: ConceptView, f: ConceptFilter) => `/map/${term}?view=${v}&filter=${f}`;

  return (
    <div className="cmap">
      <header className="cmap-head">
        <div className="cmap-title-row">
          <h1 className="cmap-title">
            {term.includes("/") ? <><span className="cmap-title-ns">{term.split("/")[0]}/</span>{term.split("/").slice(1).join("/")}</> : term}
          </h1>
          {data.concept?.kind && <StatusBadge tone="template" label={data.concept.kind} />}
          <span className="cmap-spacer" />
          <Link href={`/map/edit/${term}`} className="btn btn--ghost">Edit map</Link>
          <nav className="cmap-views" aria-label="View">
            <Link href={href("table", filter)} className={`cmap-view${view === "table" ? " cmap-view--on" : ""}`}>table</Link>
            <Link href={href("board", filter)} className={`cmap-view${view === "board" ? " cmap-view--on" : ""}`}>board</Link>
          </nav>
        </div>
        <p className="cmap-summary">{data.summary.text}</p>
        <p className="cmap-source-line">
          {data.asserters.length > 0 ? (
            <>
              When {data.asserters.map((a, i) => (
                <span key={a.slug}>{i > 0 && (i === data.asserters.length - 1 ? " or " : ", ")}{pageLink(a)}</span>
              ))} changes, everything below needs a look.
              <span className="stg-dep-when"> Last changed {relativeTime(data.asserters.reduce((m, a) => (a.updatedAt > m ? a.updatedAt : m), data.asserters[0].updatedAt))}.</span>
            </>
          ) : (
            <>No curata page owns {term}. Staleness only tracks what you mark by hand. <Link href={`/map/edit/${term}`} className="stg-dep-link">Pick a source</Link>.</>
          )}
        </p>
      </header>

      <div className="cmap-filters">
        <span className="cmap-filters-label">Show</span>
        {([
          ["all", "all"],
          ["look", "needs a look"],
          ["needs-change", "needs update"],
          ["ok", "verified"],
        ] as const).map(([f, label]) => (
          <Link key={f} href={href(view, f)} className={`cmap-filter cmap-filter--${f}${filter === f ? " cmap-filter--on" : ""}`} aria-current={filter === f ? "true" : undefined}>
            <span className="cmap-filter-dot" />
            {label}
            <span className="cmap-filter-n">{counts[f]}</span>
          </Link>
        ))}
      </div>

      {data.includes.length > 0 && (
        <div className="cmap-includes">
          <span className="cmap-includes-label">Includes</span>
          {data.includes.map((inc) => (
            <Link key={inc.term} href={`/map/${inc.term}`} className="cmap-include-chip">
              {inc.term}
              <span className="stg-dep-when">{inc.summary.text}</span>
            </Link>
          ))}
        </div>
      )}
      {data.truncated && <div className="cmap-note-warn">This tree goes deeper than shown; some sub-maps were cut off.</div>}

      {rows.length === 0 ? (
        <div className="dash-empty">Nothing depends on {term} yet. Tag pages with rel depends, or call map_dependencies.</div>
      ) : view === "board" ? (
        <Board rows={visible} term={term} />
      ) : (
        <Table rows={visible} term={term} />
      )}
    </div>
  );
}

function Table({ rows, term }: { rows: Row[]; term: string }) {
  if (rows.length === 0) return <div className="dash-empty">Nothing matches this filter.</div>;
  return (
    <table className="dash-table stg-table">
      <thead>
        <tr>
          <th className="dash-th dash-th-title" style={{ width: "32%" }}>Page / asset</th>
          <th className="dash-th">Via</th>
          <th className="dash-th">Rel</th>
          <th className="dash-th">Last verified</th>
          <th className="dash-th">Verification note</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => r.kind === "page" ? (
          <tr key={`p:${r.d.slug}:${r.d.via}:${r.d.rel}`} className="dash-row">
            <td className="dash-td dash-td-title">{pageLink(r.d)}{groupTag(r.d.group)}</td>
            <td className="dash-td">{termLink(r.d.via)}</td>
            <td className="dash-td">{relBadge(r.d.rel)}</td>
            <td className="dash-td"><span className="stg-dep-verify-cell">{verifiedCell(r.d)}{verifyButton(r, term)}</span></td>
            <td className="dash-td">{noteCell(r.d.verifiedNote)}</td>
          </tr>
        ) : (
          <tr key={`e:${r.e.id}`} className="dash-row">
            <td className="dash-td dash-td-title">
              {externalLink(r.e)}
              {r.e.owner && <span className="stg-dep-owner">{r.e.owner}</span>}
              {groupTag(r.e.group)}
            </td>
            <td className="dash-td" title={r.e.alsoDependsOn.length ? `Also tracked against ${r.e.alsoDependsOn.join(", ")}` : undefined}>
              {termLink(r.e.via)}
              {r.e.alsoDependsOn.length > 0 && <span className="stg-dep-more"> +{r.e.alsoDependsOn.length}</span>}
            </td>
            <td className="dash-td">{relBadge(r.e.rel)}</td>
            <td className="dash-td"><span className="stg-dep-verify-cell">{verifiedCell(r.e, "external")}{verifyButton(r, term)}</span></td>
            <td className="dash-td">{noteCell(r.e.verifiedNote)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const BOARD_ORDER: VerifyState[] = ["never", "stale", "needs-change", "ok"];

function Board({ rows, term }: { rows: Row[]; term: string }) {
  return (
    <div className="cmap-board">
      {BOARD_ORDER.map((state) => {
        const col = rows.filter((r) => r.state === state);
        const meta = VERIFY_STATE_LABEL[state];
        return (
          <section key={state} className="cmap-col">
            <header className="cmap-col-head">
              <StatusBadge tone={meta.tone} label={meta.page === meta.external ? meta.page : `${meta.page}`} />
              <span className="cmap-col-count">{col.length}</span>
            </header>
            {col.length === 0 && <div className="cmap-col-empty">Nothing here</div>}
            {col.map((r) => (
              <article key={r.kind === "page" ? `p:${r.d.slug}:${r.d.via}` : `e:${r.e.id}`} className="cmap-card">
                <div className="cmap-card-top">
                  <span className="cmap-card-name">{r.kind === "page" ? pageLink(r.d) : externalLink(r.e)}{groupTag(r.kind === "page" ? r.d.group : r.e.group)}</span>
                  {(r.kind === "page" ? r.d.verifiedAt : r.e.verifiedAt) && (
                    <span className="stg-dep-when">{relativeTime((r.kind === "page" ? r.d.verifiedAt : r.e.verifiedAt) as string)}</span>
                  )}
                </div>
                {(r.kind === "page" ? r.d.verifiedNote : r.e.verifiedNote) && (
                  <div className="cmap-card-note">{r.kind === "page" ? r.d.verifiedNote : r.e.verifiedNote}</div>
                )}
                <div className="cmap-card-bottom">
                  <span className="cmap-card-owner">{r.kind === "page" ? "curata page" : (r.e.owner ?? r.e.host)}</span>
                  {verifyButton(r, term)}
                </div>
              </article>
            ))}
          </section>
        );
      })}
    </div>
  );
}
