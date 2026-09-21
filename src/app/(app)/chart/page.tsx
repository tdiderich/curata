import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AUTH_MODE, resolveOrg } from "@/lib/auth";
import { getChart, getChartNode, getNeedsLook } from "@/lib/chart";
import { ChartView } from "@/components/chart-view";
import { ChartList } from "@/components/chart-list";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Content chart" };

export default async function ChartPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const ctx = await resolveOrg();
  if (!ctx) redirect(AUTH_MODE === "clerk" ? "/onboarding" : "/sign-in");
  const { view } = await searchParams;
  const list = view === "list";
  const chart = await getChart(ctx.orgId);
  const columns = list ? [] : await Promise.all(chart.nodes.map((n) => getChartNode(ctx.orgId, n.term)));
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
              {can(ctx.role, "page:edit") && <Link href="/chart/new" className="btn btn--primary">+ Add top level content item</Link>}
            </div>
            <p className="cmap-summary">
              {list
                ? "Same chart, as a list. Yellow and red only, grouped by what changed."
                : "Your pages, templates and links, arranged by what depends on what. When something at the top changes, everything below it needs a look until someone checks it."}
            </p>
          </header>
          {list ? <ChartList nodes={needs} /> : <ChartView chart={chart} columns={columns} />}
        </div>
      </div>
    </div>
  );
}
