import type { Metadata } from "next";
import { AUTH_MODE, resolveOrg } from "@/lib/auth";
import { seedOrg, seedOrgContent } from "@/lib/seed";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { ActivityFeed } from "@/components/activity-feed";
import { buildActivitySessions } from "@/lib/activity";
import { buildKnowledgeGraph } from "@/lib/graph";
import { DashboardTabs } from "@/components/dashboard-tabs";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return { title: "Dashboard" };
}

export default async function DashboardPage() {
  let ctx = await resolveOrg();
  if (!ctx && AUTH_MODE !== "clerk") {
    await seedOrg("curata");
    ctx = await resolveOrg();
  }
  if (!ctx) redirect(AUTH_MODE === "clerk" ? "/onboarding" : "/sign-in");

  // Idempotent: backfills any seed templates/workflows added to this build
  // since the org was created. seedOrg() only seeds brand-new orgs, so
  // existing orgs would otherwise never pick up new seed content.
  await seedOrgContent(ctx.orgId);

  // First-run: while the brain holds nothing but seed content, land people on
  // the getting-started walkthrough instead of an empty dashboard. The first
  // captured page flips the dashboard back to normal.
  const humanPages = await db.page.count({
    where: { orgId: ctx.orgId, createdBy: { not: "system" } },
  });
  if (humanPages === 0) {
    const gettingStarted = await db.page.findUnique({
      where: { orgId_slug: { orgId: ctx.orgId, slug: "getting-started" } },
      select: { id: true },
    });
    if (gettingStarted) redirect("/pages/getting-started");
  }

  const [graph, org, pageTitles, auditRows] = await Promise.all([
    buildKnowledgeGraph(ctx.orgId),
    db.organization.findUnique({ where: { id: ctx.orgId }, select: { name: true } }),
    db.page.findMany({ where: { orgId: ctx.orgId }, select: { slug: true, title: true } }),
    db.auditLog.findMany({ where: { orgId: ctx.orgId }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);

  const pagesBySlug = new Map(pageTitles.map((p) => [p.slug, p.title]));
  const activityFeed = buildActivitySessions(auditRows, pagesBySlug).slice(0, 50);

  return (
    <div className="dash-root">
      <div className="cleanup-header">
        <h1 className="cleanup-heading">{org?.name ?? "Knowledge"}</h1>
      </div>
      <DashboardTabs graph={graph} activity={<ActivityFeed entries={activityFeed} />} />
    </div>
  );
}
