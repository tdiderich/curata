import type { Metadata } from "next";
import { AUTH_MODE, resolveOrg } from "@/lib/auth";
import { seedOrg } from "@/lib/seed";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { ActivityFeed } from "@/components/activity-feed";
import { buildActivitySessions } from "@/lib/activity";

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

  const [pageTitles, auditRows] = await Promise.all([
    db.page.findMany({ where: { orgId: ctx.orgId }, select: { slug: true, title: true } }),
    db.auditLog.findMany({ where: { orgId: ctx.orgId }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);

  const pagesBySlug = new Map(pageTitles.map((p) => [p.slug, p.title]));
  const activityFeed = buildActivitySessions(auditRows, pagesBySlug).slice(0, 50);

  return (
    <div className="dash-root">
      <div className="cleanup-header">
        <h1 className="cleanup-heading">Activity</h1>
      </div>
      <ActivityFeed entries={activityFeed} />
    </div>
  );
}
