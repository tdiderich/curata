import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AUTH_MODE, resolveOrg } from "@/lib/auth";
import { getChart, getChartNode, getNeedsLook, type ChartGroup } from "@/lib/chart";
import { ChartCopyAll, ChartView } from "@/components/chart-view";
import { ChartList } from "@/components/chart-list";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Content map" };

type Tab = ChartGroup | "hidden";
const TAB_LABEL: Record<Tab, string> = { active: "Active", watching: "Watching", completed: "Completed", hidden: "Hidden" };
const TAB_EMPTY: Record<Tab, string> = {
  active: "Nothing in flight. A node lands here when its source page carries a meta Status that isn't finished (Planned, In progress).",
  watching: "Nothing watched yet. Pick a page that others depend on with “Add top level content item”, or build a few pages from a template.",
  completed: "Nothing finished yet. A node moves here when its source page's Status reads Shipped, Done, or Complete.",
  hidden: "Nothing hidden.",
};

/**
 * /map: one tab per group. Active = work with an end (source page has a
 * Status), Watching = standing drift watch, Completed = shipped and archived
 * by its Status, Hidden = noise someone folded away. The default tab is
 * Active when anything is in flight, else Watching.
 */
export default async function ChartPage({ searchParams }: { searchParams: Promise<{ view?: string; tab?: string }> }) {
  const ctx = await resolveOrg();
  if (!ctx) redirect(AUTH_MODE === "clerk" ? "/onboarding" : "/sign-in");
  const { view, tab: tabParam } = await searchParams;
  const list = view === "list";
  const canEdit = can(ctx.role, "page:edit");

  const full = await getChart(ctx.orgId, { includeHidden: true });
  const byTab: Record<Tab, typeof full.nodes> = { active: [], watching: [], completed: [], hidden: [] };
  for (const n of full.nodes) byTab[n.hidden ? "hidden" : n.group].push(n);
  const tab: Tab = (["active", "watching", "completed", "hidden"] as Tab[]).includes(tabParam as Tab)
    ? (tabParam as Tab)
    : byTab.active.length > 0 ? "active" : "watching";
  const attention = (t: Tab) => byTab[t].reduce((s, n) => s + n.counts.red + n.counts.yellow, 0);

  const columns = list ? [] : await Promise.all(byTab[tab].map((n) => getChartNode(ctx.orgId, n.term)));
  const needs = list ? await getNeedsLook(ctx.orgId) : [];
  const visible = full.nodes.filter((n) => !n.hidden);
  const totals = { red: 0, yellow: 0, green: 0 };
  for (const n of visible) { totals.red += n.counts.red; totals.yellow += n.counts.yellow; totals.green += n.counts.green; }

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
                <span className="chart-dot chart-dot--red" /> {totals.red}
                <span className="chart-dot chart-dot--yellow" /> {totals.yellow}
                <span className="chart-dot chart-dot--green" /> {totals.green}
              </span>
              <nav className="cmap-views">
                <Link href="/map" className={`cmap-view${list ? "" : " cmap-view--on"}`}>Map</Link>
                <Link href="/map?view=list" className={`cmap-view${list ? " cmap-view--on" : ""}`}>List</Link>
              </nav>
              {!list && canEdit && <ChartCopyAll columns={columns} />}
              {canEdit && <Link href="/map/new" className="btn btn--primary">+ Add top level content item</Link>}
            </div>
            {list ? (
              <p className="cmap-summary">Pages that have potentially drifted from their source. Review manually or generate a prompt for your agent to take a pass.</p>
            ) : (
              <nav className="cmap-tabs" aria-label="Map groups">
                {(["active", "watching", "completed", "hidden"] as Tab[]).map((t) => {
                  const n = byTab[t].length;
                  const a = attention(t);
                  if (t === "hidden" && n === 0) return null;
                  return (
                    <Link key={t} href={t === "watching" && byTab.active.length === 0 ? "/map" : `/map?tab=${t}`} className={`cmap-tab${tab === t ? " cmap-tab--on" : ""}`}>
                      {TAB_LABEL[t]}
                      <span className="cmap-tab-count">{n}</span>
                      {a > 0 && t !== tab && <span className="cmap-tab-attn" title={`${a} need a look`}>{a}</span>}
                    </Link>
                  );
                })}
              </nav>
            )}
          </header>
          {list
            ? <ChartList nodes={needs} canEdit={canEdit} />
            : columns.length === 0
              ? <div className="cmap-col-empty chart-empty">{TAB_EMPTY[tab]}</div>
              : <ChartView chart={{ nodes: byTab[tab], totals }} columns={columns} />}
        </div>
      </div>
    </div>
  );
}
