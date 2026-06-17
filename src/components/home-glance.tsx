import Link from "next/link";
import {
  extractGlanceSections,
  buildGlanceCard,
  extractCustomPrompts,
  buildGlanceSections,
  buildRecentlyCard,
  buildStaleCard,
  buildFlagCard,
  buildPageOptedCards,
  type GlanceFallbacks,
  type RecentPageInfo,
  type StalePageInfo,
  type FlagInfo,
  type DashboardPageInfo,
} from "@/lib/glance-prompts";
import { GlanceCards, type CardSection } from "@/components/glance-cards";

export interface GlanceFolder {
  name: string;
  count: number;
}

function ActivityChart({ activity }: { activity: number[] }) {
  const max = Math.max(...activity, 1);
  const w = 8;
  const gap = 3;
  const height = 64;
  return (
    <svg
      className="glance-activity-svg"
      viewBox={`0 0 ${activity.length * (w + gap) - gap} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Page edits per day, last 30 days"
    >
      {activity.map((v, i) => {
        const h = v === 0 ? 2 : Math.max((v / max) * height, 4);
        return (
          <rect
            key={i}
            x={i * (w + gap)}
            y={height - h}
            width={w}
            height={h}
            rx={1.5}
            className={v === 0 ? "glance-activity-bar--zero" : "glance-activity-bar"}
          />
        );
      })}
    </svg>
  );
}

function FolderBars({ folders }: { folders: GlanceFolder[] }) {
  const max = Math.max(...folders.map((f) => f.count), 1);
  return (
    <div className="glance-folder-bars">
      {folders.map((f) => (
        <div className="glance-folder-row" key={f.name}>
          <span className="glance-folder-name">{f.name}</span>
          <span className="glance-folder-track">
            <span className="glance-folder-fill" style={{ width: `${(f.count / max) * 100}%` }} />
          </span>
          <span className="glance-folder-count">{f.count}</span>
        </div>
      ))}
    </div>
  );
}

const ORIENTATION = /what this workspace is/i;

export function HomeGlance({
  json,
  origin,
  activity = [],
  folders = [],
  fallbacks = {},
  recentPages = [],
  recentWindowLabel = "today",
  stalePages = [],
  flagInfos = [],
  dashboardPageInfos = [],
}: {
  json: Record<string, unknown>;
  origin?: string;
  activity?: number[];
  folders?: GlanceFolder[];
  fallbacks?: GlanceFallbacks;
  recentPages?: RecentPageInfo[];
  recentWindowLabel?: string;
  stalePages?: StalePageInfo[];
  flagInfos?: FlagInfo[];
  dashboardPageInfos?: DashboardPageInfo[];
}) {
  const ctx = { origin };
  const components = (json.components ?? []) as Array<{ type: string; [key: string]: unknown }>;
  const glanceSections = extractGlanceSections(components);

  const orientation = glanceSections.find((s) => ORIENTATION.test(s.heading));

  // Stock computed cards
  const recentlyCard = buildRecentlyCard(recentPages, recentWindowLabel, ctx);
  const attentionSections = buildGlanceSections(
    glanceSections.filter((s) => !ORIENTATION.test(s.heading)),
    fallbacks
  );
  const attentionCard = buildGlanceCard(
    attentionSections.find((s) => /attention/i.test(s.heading)) ?? { heading: "Needs attention", body: fallbacks.attention ?? "" },
    ctx
  );
  const plansCard = buildGlanceCard(
    attentionSections.find((s) => /plans? in motion|plans?$/i.test(s.heading)) ?? { heading: "Plans in motion", body: fallbacks.plans ?? "" },
    ctx
  );
  const staleCard = buildStaleCard(stalePages, ctx);
  const flagCard = buildFlagCard(flagInfos, ctx);

  // Page-opted cards
  const pageOptedCards = buildPageOptedCards(dashboardPageInfos, ctx);

  // Legacy home-page prompts block
  const legacyCards = extractCustomPrompts(json, ctx);

  const statusCards = [recentlyCard, attentionCard, plansCard, staleCard, flagCard].map((c) => ({ ...c, category: "Status" }));

  const categorized = new Map<string, typeof pageOptedCards>();
  for (const card of pageOptedCards) {
    const cat = card.category ?? "Other";
    const arr = categorized.get(cat) ?? [];
    arr.push(card);
    categorized.set(cat, arr);
  }
  if (legacyCards.length > 0) {
    const arr = categorized.get("Other") ?? [];
    arr.push(...legacyCards);
    categorized.set("Other", arr);
  }

  const sortedCategories = [...categorized.keys()].sort((a, b) => {
    if (a === "Other") return 1;
    if (b === "Other") return -1;
    return a.localeCompare(b);
  });

  const cardSections: CardSection[] = [];
  if (statusCards.length > 0) cardSections.push({ label: "Status", cards: statusCards });
  for (const cat of sortedCategories) {
    const cards = categorized.get(cat)!;
    cardSections.push({ label: cat, cards });
  }

  const title = (json.title as string) || "Curata at a glance";

  return (
    <section className="home-glance" aria-label="Workspace overview">
      <div className="home-glance-hero">
        <div className="home-glance-header">
          <h1 className="home-glance-title">{title}</h1>
          <span className="home-glance-meta">
            <Link href="/pages/home" className="home-glance-source">edit prompts</Link>
          </span>
        </div>
        {orientation && <p className="home-glance-orientation">{orientation.body.trim()}</p>}
      </div>
      {(activity.some((v) => v > 0) || folders.length > 0) && (
        <>
          <div className="home-glance-visuals">
            {activity.length > 0 && (
              <div className="glance-visual">
                <div className="glance-visual-label">Activity — page edits per day, last 30 days</div>
                <ActivityChart activity={activity} />
              </div>
            )}
            {folders.length > 0 && (
              <div className="glance-visual">
                <div className="glance-visual-label">Pages by folder</div>
                <FolderBars folders={folders} />
              </div>
            )}
          </div>
          <div className="home-glance-divider" aria-hidden="true" />
        </>
      )}
      <GlanceCards sections={cardSections} />
    </section>
  );
}
