import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AUTH_MODE, resolveOrg } from "@/lib/auth";
import { getChart, getChartNode, getNeedsLook } from "@/lib/chart";
import { ChartView } from "@/components/chart-view";
import { ChartList } from "@/components/chart-list";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Content chart" };

export default async function ChartPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const ctx = await resolveOrg();
  if (!ctx) redirect(AUTH_MODE === "clerk" ? "/onboarding" : "/sign-in");
  const { view } = await searchParams;
  const list = view === "list";
  const chart = await getChart(ctx.orgId);
  const worst = !list && chart.nodes.length > 0
    ? await getChartNode(ctx.orgId, [...chart.nodes].sort((a, b) => ["red", "yellow", "green"].indexOf(a.color) - ["red", "yellow", "green"].indexOf(b.color))[0].term)
    : null;
  const needs = list ? await getNeedsLook(ctx.orgId) : [];
  return (
    <div className="dash-root">
      <div className="dash-workspace">
        <div className="cmap-nav"><Link href="/dashboard" className="btn btn--ghost">← Home</Link></div>
        <div className="cmap">
          <header className="cmap-head">
            <div className="cmap-title-row">
              <h1 className="cmap-title">{list ? "Needs a look" : "Content"}</h1>
              <span className="cmap-spacer" />
              <span className="chart-totals">
                <span className="chart-dot chart-dot--red" /> {chart.totals.red}
                <span className="chart-dot chart-dot--yellow" /> {chart.totals.yellow}
                <span className="chart-dot chart-dot--green" /> {chart.totals.green}
              </span>
              <nav className="cmap-views">
                <Link href="/chart" className={`cmap-view${list ? "" : " cmap-view--on"}`}>Chart</Link>
                <Link href="/chart?view=list" className={`cmap-view${list ? " cmap-view--on" : ""}`}>List</Link>
              </nav>
            </div>
            <p className="cmap-summary">
              {list
                ? "Same chart, as a list. Yellow and red only, grouped by what changed."
                : "Drawn from templates, components, sources and links. Change a node, everything under it changes color."}
            </p>
          </header>
          {list ? <ChartList nodes={needs} /> : <ChartView chart={chart} expanded={worst} />}
        </div>
      </div>
    </div>
  );
}
