import Link from "next/link";
import type { ConceptMapRow } from "@/lib/concepts";
import { flagBadges } from "@/components/concept-map-index";

/**
 * Dashboard card: the top concepts by "still needs a look", same ranking as
 * /map. Renders nothing when every graph is clean so the home stays quiet.
 */
export function NeedsLookCard({ rows }: { rows: ConceptMapRow[] }) {
  const open = rows.filter((r) => r.needsLook > 0);
  if (open.length === 0) return null;
  const totalLook = open.reduce((n, r) => n + r.needsLook, 0);
  return (
    <section className="nlc">
      <header className="nlc-head">
        <span className="nlc-label">Needs a look</span>
        <Link href="/map" className="nlc-open">Open map →</Link>
      </header>
      <p className="nlc-sub">{totalLook} thing{totalLook === 1 ? "" : "s"} across {open.length} change{open.length === 1 ? "" : "s"} not checked since the source moved.</p>
      <ul className="nlc-list">
        {open.slice(0, 4).map((r) => (
          <li key={r.term} className="nlc-row">
            <Link href={`/map/${r.term}`} className="nlc-term">{r.term}</Link>
            <span className="nlc-count"><strong>{r.needsLook}</strong> / {r.total}</span>
            <span className="nlc-flags">{flagBadges(r).slice(0, 1)}</span>
            <Link href={`/map/${r.term}`} className="nlc-go" aria-label={`Open ${r.term}`}>→</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
