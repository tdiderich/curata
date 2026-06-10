import type { Metadata } from "next";
import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_MODE, resolveOrg } from "@/lib/auth";
import { seedOrg } from "@/lib/seed";
import { db } from "@/lib/db";
import { ensureHomePage } from "@/lib/default-home";
import { HomeGlance, GlanceStat } from "@/components/home-glance";

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

  // The at-a-glance launcher IS the dashboard. The home page exists by
  // default (created on first visit) and users/agents edit it from there;
  // page browsing lives in the sidebar and the ⌘K palette.
  const home = await ensureHomePage(ctx.orgId, ctx.orgSlug);

  // Instance origin for copy-prompt cards, so pasted prompts name the exact
  // curata deployment and MCP endpoint the agent should target.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  const origin = host ? `${proto}://${host}` : undefined;

  const monthAgo = new Date();
  monthAgo.setDate(monthAgo.getDate() - 30);
  const pageScope = { orgId: ctx.orgId, status: { not: "archived" }, slug: { not: "home" } };
  // "Updated" means a content write (a new PageVersion), not a row touch —
  // page.updatedAt is Prisma @updatedAt and fires on flag changes, folder
  // moves, and migrations, which made every page look freshly edited.
  const [totalPages, recentVersions, pendingAnnotationCount, pendingAnnotations, folderRows, planPages] =
    await Promise.all([
      db.page.count({ where: pageScope }),
      db.pageVersion.findMany({
        where: { createdAt: { gte: monthAgo }, page: pageScope },
        select: { createdAt: true, pageId: true, page: { select: { slug: true, title: true } } },
        orderBy: { createdAt: "desc" },
      }),
      // Same scope as the Needs-attention card — counting annotations on
      // archived pages or home made the stat disagree with the card.
      db.annotation.count({ where: { page: pageScope, status: "pending" } }),
      db.annotation.findMany({
        where: { page: { ...pageScope }, status: "pending" },
        take: 6,
        orderBy: { createdAt: "desc" },
        select: { text: true, page: { select: { slug: true, title: true } } },
      }),
      db.folder.findMany({
        where: { orgId: ctx.orgId },
        select: { name: true, _count: { select: { pages: { where: { status: { not: "archived" } } } } } },
      }),
      db.page.findMany({
        where: {
          ...pageScope,
          // Plans folders only — workflow folders hold runbooks (procedures),
          // not work in flight, and were inflating the card.
          folder: { name: { contains: "plan", mode: "insensitive" } },
        },
        orderBy: { updatedAt: "desc" },
        take: 5,
        select: { slug: true, title: true },
      }),
    ]);

  const updatedPageIds = new Set(recentVersions.map((v) => v.pageId));
  const updated30d = updatedPageIds.size;

  const stats: GlanceStat[] = [
    { label: "pages", value: String(totalPages) },
    { label: "edits last 30d", value: String(recentVersions.length) },
    { label: "pages touched 30d", value: String(updated30d) },
    { label: "untouched >30d", value: String(Math.max(totalPages - updated30d, 0)) },
    { label: "open annotations", value: String(pendingAnnotationCount) },
  ];

  // Content-writes-per-day buckets for the 30-day activity chart, oldest first.
  const dayMs = 24 * 60 * 60 * 1000;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const activity = new Array(30).fill(0) as number[];
  for (const v of recentVersions) {
    const daysAgo = Math.floor((todayStart.getTime() + dayMs - v.createdAt.getTime()) / dayMs);
    const idx = 29 - Math.min(daysAgo, 29);
    activity[idx] += 1;
  }

  const folders = folderRows
    .map((f) => ({ name: f.name, count: f._count.pages }))
    .filter((f) => f.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  // Live fallback bodies for sections no workflow has written yet.
  const now = new Date();
  const relTime = (d: Date) => {
    const hours = (now.getTime() - d.getTime()) / 36e5;
    if (hours < 1) return "just now";
    if (hours < 24) return `${Math.floor(hours)}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };
  const seenPages = new Set<string>();
  const recentBullets: string[] = [];
  for (const v of recentVersions) {
    if (seenPages.has(v.pageId)) continue;
    seenPages.add(v.pageId);
    recentBullets.push(`- Updated [${v.page.title}](${v.page.slug}) — ${relTime(v.createdAt)}`);
    if (recentBullets.length >= 6) break;
  }
  const fallbacks = {
    recently: recentBullets.join("\n"),
    attention: pendingAnnotations
      .map((a) => `- [${a.page.title}](${a.page.slug}) — open annotation: "${a.text.slice(0, 80)}"`)
      .join("\n"),
    plans: planPages.map((p) => `- [${p.title}](${p.slug}) — active`).join("\n"),
  };

  if (!home) {
    // ensureHomePage only fails on a write/validation error; surface a plain
    // empty state rather than a broken glance.
    return <div className="dash-root">Could not load the workspace home page.</div>;
  }

  return (
    <Suspense>
      <HomeGlance
        json={home}
        origin={origin}
        stats={stats}
        activity={activity}
        folders={folders}
        fallbacks={fallbacks}
      />
    </Suspense>
  );
}
