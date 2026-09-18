import Link from "next/link";
import type { DependentsResult } from "@/lib/concepts";

/**
 * One chip under a page title. A source-of-truth page says how many of its
 * dependents still need a look; a dependent page says what it depends on and
 * whether any source has moved. Links into /map. Renders nothing for a page
 * with no depends/asserts edges, so most pages never see it.
 */
export function DependencyPill({ data }: { data: DependentsResult }) {
  const asserts = data.concepts.filter((c) => c.rel === "asserts").map((c) => c.term);
  const depends = data.concepts.filter((c) => c.rel === "depends").map((c) => c.term);

  if (asserts.length > 0) {
    const total = data.summary.pages.total + data.summary.external.total;
    const look = total - data.summary.pages.ok - data.summary.external.ok;
    const needsChange = data.summary.pages.needsChange + data.summary.external.needsChange;
    return (
      <Link href={`/map/${asserts[0]}`} className={`dep-pill dep-pill--source${look > 0 ? " dep-pill--warn" : ""}`}>
        <span className="dep-pill-kind">Source of truth</span>
        <span className="dep-pill-terms">{asserts.join(" · ")}</span>
        <span className="dep-pill-sep">·</span>
        <span className="dep-pill-stat">
          {total === 0 ? "nothing depends on it yet" : look === 0 ? `all ${total} checked` : `${look} of ${total} need a look`}
          {needsChange > 0 && `, ${needsChange} needs update`}
        </span>
        <span className="dep-pill-go">→</span>
      </Link>
    );
  }

  if (depends.length > 0) {
    // What this page depends on: asserters are the sources; a gap is a
    // concept nobody owns. Stale-for-me is computed by the settings tab per
    // edge; here we surface the cheaper signal, whether any source exists.
    const gaps = data.asserterGaps.length;
    return (
      <Link href={`/pages/${data.page?.slug}/settings?tab=dependencies`} className={`dep-pill${gaps > 0 ? " dep-pill--warn" : ""}`}>
        <span className="dep-pill-kind">Depends on {depends.length}</span>
        <span className="dep-pill-terms">{depends.slice(0, 3).join(" · ")}{depends.length > 3 ? ` +${depends.length - 3}` : ""}</span>
        {gaps > 0 && <><span className="dep-pill-sep">·</span><span className="dep-pill-stat">{gaps} without a source</span></>}
        <span className="dep-pill-go">→</span>
      </Link>
    );
  }
  return null;
}
