import Link from "next/link";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ChartCopyAll, ChartView } from "@/components/chart-view";
import { ChartList } from "@/components/chart-list";
import { ChartNodeDetail } from "@/components/chart-node";
import { NewNodeForm } from "@/components/chart-new-node";
import type { ChartGroup } from "@/lib/chart";
import { allNodes, needsLook, pricingNode, searchPages } from "./map.fixtures";

// Screens for the content map help videos (map, map-node, map-new). The /map
// and /map/new pages are server components, so their header markup is copied
// here around the real client components. Fixture data only.

/** Fixture answers for reads the map components make. Installed in beforeEach. */
function mockFetch() {
  const real = window.fetch;
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("/api/search")) {
      const q = (new URL(url, window.location.origin).searchParams.get("query") ?? "").toLowerCase();
      return json(searchPages.filter((p) => p.title.toLowerCase().includes(q)));
    }
    if (url.includes("/api/chart/scope")) return json([]);
    return real(input, init);
  };
  return () => { window.fetch = real; };
}

const TAB_LABEL: Record<ChartGroup, string> = { active: "Active", watching: "Watching", completed: "Done" };

function MapScreen({ list = false, tab = "watching" }: { list?: boolean; tab?: ChartGroup }) {
  const byTab: Record<ChartGroup, typeof allNodes> = { active: [], watching: [], completed: [] };
  for (const n of allNodes) byTab[n.group].push(n);
  const columns = byTab[tab];
  const totals = { red: 0, yellow: 0, green: 0 };
  for (const n of allNodes) { totals.red += n.counts.red; totals.yellow += n.counts.yellow; totals.green += n.counts.green; }
  const attention = (t: ChartGroup) => byTab[t].reduce((s, n) => s + n.counts.red + n.counts.yellow, 0);
  return (
    <div className="app-shell">
      <main className="app-main">
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
                  {!list && <ChartCopyAll columns={columns} />}
                  <Link href="/map/new" className="btn btn--primary">+ Add top level content item</Link>
                </div>
                {list ? (
                  <p className="cmap-summary">Pages that have potentially drifted from their source. Review manually or generate a prompt for your agent to take a pass.</p>
                ) : (
                  <nav className="cmap-tabs" aria-label="Map groups">
                    {(["active", "watching", "completed"] as ChartGroup[]).map((t) => {
                      const a = attention(t);
                      return (
                        <Link key={t} href={`/map?tab=${t}`} className={`cmap-tab${tab === t ? " cmap-tab--on" : ""}`}>
                          {TAB_LABEL[t]}
                          <span className="cmap-tab-count">{byTab[t].length}</span>
                          {a > 0 && t !== tab && <span className="cmap-tab-attn" title={`${a} need a look`}>{a}</span>}
                        </Link>
                      );
                    })}
                  </nav>
                )}
              </header>
              {list ? <ChartList nodes={needsLook} canEdit /> : <ChartView chart={{ nodes: columns, totals }} columns={columns} />}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function NodeScreen() {
  return (
    <div className="app-shell">
      <main className="app-main">
        <div className="dash-root">
          <div className="dash-workspace">
            <div className="cmap-nav"><Link href="/map" className="btn btn--ghost">← Content</Link></div>
            <ChartNodeDetail node={pricingNode} canEdit />
          </div>
        </div>
      </main>
    </div>
  );
}

function NewScreen() {
  return (
    <div className="app-shell">
      <main className="app-main">
        <div className="dash-root">
          <div className="dash-workspace">
            <div className="cmap-nav"><Link href="/map" className="btn btn--ghost">← Content</Link></div>
            <div className="cmap">
              <header className="cmap-head">
                <h1 className="cmap-title">New top level content item</h1>
                <p className="cmap-summary">Name the thing, point at the page that owns the truth for it, and list what depends on it. When that page changes, everything under it needs a look.</p>
              </header>
              <NewNodeForm />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

const meta = {
  title: "Demo/Map",
  parameters: {
    demoScreen: true,
    layout: "fullscreen",
    nextjs: { appDirectory: true, navigation: { pathname: "/map" } },
  },
  beforeEach: () => mockFetch(),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** /map on the Watching tab: four standing pages, every color. */
export const ContentMap: Story = { render: () => <MapScreen /> };

/** /map on the Active tab. */
export const MapActive: Story = { render: () => <MapScreen tab="active" /> };

/** /map?view=list: everything that needs a look. */
export const List: Story = { render: () => <MapScreen list /> };

/** /map/pricing: one node with red, yellow and green rows. */
export const Node: Story = {
  parameters: { nextjs: { appDirectory: true, navigation: { pathname: "/map/pricing" } } },
  render: () => <NodeScreen />,
};

/** /map/new: the empty form. Capture steps type into it. */
export const New: Story = {
  parameters: { nextjs: { appDirectory: true, navigation: { pathname: "/map/new" } } },
  render: () => <NewScreen />,
};
