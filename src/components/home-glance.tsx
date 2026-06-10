import Link from "next/link";
import { formatRefreshAge } from "@/lib/home-glance";
import {
  extractGlanceSections,
  buildGlanceCard,
  extractCustomPrompts,
  applyFallbacks,
  type GlanceFallbacks,
} from "@/lib/glance-prompts";
import { GlanceCards } from "@/components/glance-cards";

export interface GlanceStat {
  label: string;
  value: string;
}

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
      aria-label="Pages updated per day, last 30 days"
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

// The orientation section ("What this workspace is") renders as prose; every
// other section becomes an action card whose click copies a context-loaded
// agent prompt. The glance is a launcher, not a report.
const ORIENTATION = /what this workspace is/i;

export function HomeGlance({
  json,
  updatedAt,
  origin,
  stats = [],
  activity = [],
  folders = [],
  fallbacks = {},
}: {
  json: Record<string, unknown>;
  updatedAt: Date;
  origin?: string;
  stats?: GlanceStat[];
  activity?: number[];
  folders?: GlanceFolder[];
  fallbacks?: GlanceFallbacks;
}) {
  const components = (json.components ?? []) as Array<{ type: string; [key: string]: unknown }>;
  if (components.length === 0) return null;

  const sections = extractGlanceSections(components);
  if (sections.length === 0) return null;

  const orientation = sections.find((s) => ORIENTATION.test(s.heading));
  const cards = applyFallbacks(
    sections.filter((s) => !ORIENTATION.test(s.heading)),
    fallbacks
  ).map((s) => buildGlanceCard(s, { origin }));
  const customCards = extractCustomPrompts(json, { origin });

  const { label, stale } = formatRefreshAge(updatedAt);
  const title = (json.title as string) || "Curata at a glance";

  return (
    <section className="home-glance" aria-label="Workspace overview">
      <div className="home-glance-hero">
        <div className="home-glance-header">
          <h1 className="home-glance-title">{title}</h1>
          <span className="home-glance-meta">
            refreshed {label}
            <Link href="/pages/home" className="home-glance-source">view page</Link>
          </span>
        </div>
        {orientation && <p className="home-glance-orientation">{orientation.body.trim()}</p>}
      </div>
      {stale && (
        <div className="home-glance-stale" role="status">
          Last refreshed {label} — sections may be outdated.
        </div>
      )}
      {stats.length > 0 && (
        <>
          <div className="home-glance-stats">
            {stats.map((s) => (
              <div className="glance-stat" key={s.label}>
                <span className="glance-stat-value">{s.value}</span>
                <span className="glance-stat-label">{s.label}</span>
              </div>
            ))}
          </div>
          <div className="home-glance-divider" aria-hidden="true" />
        </>
      )}
      {(activity.some((v) => v > 0) || folders.length > 0) && (
        <>
          <div className="home-glance-visuals">
            {activity.length > 0 && (
              <div className="glance-visual">
                <div className="glance-visual-label">Activity — pages updated per day, last 30 days</div>
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
      <GlanceCards cards={[...cards, ...customCards]} />
    </section>
  );
}
