import Link from "next/link";
import { formatRefreshAge } from "@/lib/home-glance";
import { extractGlanceSections, buildGlanceCard, extractCustomPrompts } from "@/lib/glance-prompts";
import { GlanceCards } from "@/components/glance-cards";

export interface GlanceStat {
  label: string;
  value: string;
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
}: {
  json: Record<string, unknown>;
  updatedAt: Date;
  origin?: string;
  stats?: GlanceStat[];
}) {
  const components = (json.components ?? []) as Array<{ type: string; [key: string]: unknown }>;
  if (components.length === 0) return null;

  const sections = extractGlanceSections(components);
  if (sections.length === 0) return null;

  const orientation = sections.find((s) => ORIENTATION.test(s.heading));
  const cards = sections
    .filter((s) => !ORIENTATION.test(s.heading))
    .map((s) => buildGlanceCard(s, { origin }));
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
      <GlanceCards cards={[...cards, ...customCards]} />
    </section>
  );
}
