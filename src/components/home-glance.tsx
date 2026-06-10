import Link from "next/link";
import { formatRefreshAge } from "@/lib/home-glance";
import { extractGlanceSections, buildGlanceCard } from "@/lib/glance-prompts";
import { GlanceCard } from "@/components/glance-card";

// The orientation section ("What this workspace is") renders as prose; every
// other section becomes an action card whose click copies a context-loaded
// agent prompt. The glance is a launcher, not a report.
const ORIENTATION = /what this workspace is/i;

export function HomeGlance({
  json,
  updatedAt,
}: {
  json: Record<string, unknown>;
  updatedAt: Date;
}) {
  const components = (json.components ?? []) as Array<{ type: string; [key: string]: unknown }>;
  if (components.length === 0) return null;

  const sections = extractGlanceSections(components);
  if (sections.length === 0) return null;

  const orientation = sections.find((s) => ORIENTATION.test(s.heading));
  const cards = sections.filter((s) => !ORIENTATION.test(s.heading)).map(buildGlanceCard);

  const { label, stale } = formatRefreshAge(updatedAt);
  const title = (json.title as string) || "Curata at a glance";

  return (
    <section className="home-glance" aria-label="Workspace overview">
      <div className="home-glance-header">
        <span className="home-glance-title">{title}</span>
        <span className="home-glance-meta">
          refreshed {label}
          <Link href="/pages/home" className="home-glance-source">view page</Link>
        </span>
      </div>
      {stale && (
        <div className="home-glance-stale" role="status">
          Last refreshed {label} — sections may be outdated.
        </div>
      )}
      {orientation && <p className="home-glance-orientation">{orientation.body.trim()}</p>}
      <div className="home-glance-cards">
        {cards.map((card) => (
          <GlanceCard key={card.title} card={card} />
        ))}
      </div>
    </section>
  );
}
