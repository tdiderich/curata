import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AUTH_MODE, resolveOrg } from "@/lib/auth";
import { getDependents, normalizeTerm } from "@/lib/concepts";
import { ConceptDependents, type ConceptView, type ConceptFilter } from "@/components/concept-dependents";

export const dynamic = "force-dynamic";

type Params = { term: string[] };
type Search = { view?: string; filter?: string };

function termOf(params: Params) {
  return normalizeTerm(decodeURIComponent(params.term.join("/")));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  return { title: termOf(await params) };
}

/**
 * /map/<term>: one concept, everything that depends on it, what has been
 * checked since the source moved. The term may carry one slash
 * (pricing/tier-2), hence the catch-all segment.
 */
export default async function ConceptMapPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Search> }) {
  const ctx = await resolveOrg();
  if (!ctx) redirect(AUTH_MODE === "clerk" ? "/onboarding" : "/sign-in");
  const term = termOf(await params);
  const sp = await searchParams;
  const view: ConceptView = sp.view === "board" ? "board" : "table";
  const filter: ConceptFilter = (["all", "look", "needs-change", "ok"] as const).includes(sp.filter as ConceptFilter) ? (sp.filter as ConceptFilter) : "all";

  let data;
  try {
    data = await getDependents(ctx.orgId, { term });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return (
      <div className="dash-root">
        <div className="dash-workspace">
          <div className="cmap-nav"><Link href="/map" className="btn btn--ghost">← Map</Link></div>
          <div className="dash-empty">{message}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="dash-root">
      <div className="dash-workspace">
        <div className="cmap-nav"><Link href="/map" className="btn btn--ghost">← Map</Link></div>
        <ConceptDependents data={data} term={term} view={view} filter={filter} />
      </div>
    </div>
  );
}
