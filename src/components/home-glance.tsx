import Link from "next/link";
import { PageRenderer } from "@/generated/kazam-renderer";
import { formatRefreshAge } from "@/lib/home-glance";

export function HomeGlance({
  json,
  updatedAt,
}: {
  json: Record<string, unknown>;
  updatedAt: Date;
}) {
  const components = (json.components ?? []) as Array<{ type: string; [key: string]: unknown }>;
  if (components.length === 0) return null;

  const { label, stale } = formatRefreshAge(updatedAt);

  const page = {
    title: (json.title as string) || "Curata at a glance",
    subtitle: (json.subtitle as string) || undefined,
    shell: (json.shell as string) || "standard",
    components,
  };

  return (
    <section className="home-glance" aria-label="Workspace overview">
      <div className="home-glance-header">
        <span className="home-glance-title">{page.title}</span>
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
      <div className="home-glance-body">
        <PageRenderer page={page} activeHubHref="home" />
      </div>
    </section>
  );
}
