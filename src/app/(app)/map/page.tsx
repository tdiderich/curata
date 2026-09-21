import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AUTH_MODE, resolveOrg } from "@/lib/auth";
import { getChart, getChartNode, getNeedsLook } from "@/lib/chart";
import { ChartCopyAll, ChartView } from "@/components/chart-view";
import { ChartList } from "@/components/chart-list";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Content map" };

export default async function ChartPage({ searchParams }: { searchParams: Promise<{ view?: string; hidden?: string }> }) {
  const ctx = await resolveOrg();
  if (!ctx) redirect(AUTH_MODE === "clerk" ? "/onboarding" : "/sign-in");
  const { view, hidden } = await searchParams;
  const list = view === "list";
  const showHidden = hidden === "1";
  const [chart, full] = await Promise.all([getChart(ctx.orgId), getChart(ctx.orgId, { includeHidden: true })]);
  const hiddenCount = full.nodes.length - chart.nodes.length;
  const shown = showHidden ? full : chart;
  const columns = list ? [] : await Promise.all(shown.nodes.map((n) => getChartNode(ctx.orgId, n.term)));
  const needs = list ? await getNeedsLook(ctx.orgId) : [];
  return (
    <div className="dash-root">
      <div className="dash-workspace">
        <div className="cmap-nav"><Link href="/dashboard" className="btn btn--ghost">← Home</Link></div>
        <div className="cmap">
          <header className="cmap-head">
            <div className="cmap-title-row">
              <h1 className="cmap-title">{list ? "Needs a look" : "Content map"}</h1>
              <span className="cmap-spacer" />
              <span className="chart-totals">
                <span className="chart-dot chart-dot--red" /> {chart.totals.red}
                <span className="chart-dot chart-dot--yellow" /> {chart.totals.yellow}
                <span className="chart-dot chart-dot--green" /> {chart.totals.green}
              </span>
              <nav className="cmap-views">
                <Link href="/map" className={`cmap-view${list ? "" : " cmap-view--on"}`}>Map</Link>
                <Link href="/map?view=list" className={`cmap-view${list ? " cmap-view--on" : ""}`}>List</Link>
              </nav>
              {!list && can(ctx.role, "page:edit") && <ChartCopyAll columns={columns} />}
              {can(ctx.role, "page:edit") && <Link href="/map/new" className="btn btn--primary">+ Add top level content item</Link>}
            </div>
            {list && <p className="cmap-summary">Pages that have potentially drifted from their source. Review manually or generate a prompt for your agent to take a pass.</p>}
          </header>
          {list ? <ChartList nodes={needs} canEdit={can(ctx.role, "page:edit")} /> : <ChartView chart={shown} columns={columns} />}
          {!list && hiddenCount > 0 && (
            <p className="cmap-hidden-note">
              {hiddenCount} hidden node{hiddenCount === 1 ? "" : "s"}.{" "}
              {showHidden ? <Link href="/map">Hide again</Link> : <Link href="/map?hidden=1">Show</Link>}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
