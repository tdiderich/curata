import type { Metadata } from "next";
import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_MODE, resolveOrg } from "@/lib/auth";
import { seedOrg } from "@/lib/seed";
import { db } from "@/lib/db";
import { ensureHomePage } from "@/lib/default-home";
import { HomeGlance } from "@/components/home-glance";
import { listPages } from "@/lib/pages";
import type { StalePageInfo, FlagInfo, RecentPageInfo, DashboardPageInfo } from "@/lib/glance-prompts";

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

  const dayMs = 24 * 60 * 60 * 1000;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const week7Ago = new Date(todayStart.getTime() - 7 * dayMs);
  const week14Ago = new Date(todayStart.getTime() - 14 * dayMs);
  const monthAgo = new Date();
  monthAgo.setDate(monthAgo.getDate() - 30);
  const pageScope = { orgId: ctx.orgId, status: { not: "archived" }, slug: { not: "home" } };
  const versionSelect = { createdAt: true, pageId: true, page: { select: { slug: true, title: true, folder: { select: { name: true } } } } } as const;

  // "Updated" means a content write (a new PageVersion), not a row touch —
  // page.updatedAt is Prisma @updatedAt and fires on flag changes, folder
  // moves, and migrations, which made every page look freshly edited.
  const [
    allPageMeta,
    recentVersions1d,
    recentVersions7d,
    recentVersions14d,
    recentVersions30d,
    pendingAnnotations,
    pendingFlags,
    dashboardPages,
    folderRows,
    planPages,
  ] = await Promise.all([
    listPages(ctx.orgId),
    db.pageVersion.findMany({
      where: { createdAt: { gte: todayStart }, page: pageScope },
      select: versionSelect,
      orderBy: { createdAt: "desc" },
    }),
    db.pageVersion.findMany({
      where: { createdAt: { gte: week7Ago }, page: pageScope },
      select: versionSelect,
      orderBy: { createdAt: "desc" },
    }),
    db.pageVersion.findMany({
      where: { createdAt: { gte: week14Ago }, page: pageScope },
      select: versionSelect,
      orderBy: { createdAt: "desc" },
    }),
    db.pageVersion.findMany({
      where: { createdAt: { gte: monthAgo }, page: pageScope },
      select: versionSelect,
      orderBy: { createdAt: "desc" },
    }),
    db.annotation.findMany({
      where: { page: { ...pageScope }, status: "pending" },
      take: 10,
      orderBy: { createdAt: "desc" },
      select: { text: true, page: { select: { slug: true, title: true } } },
    }),
    db.pageFlag.findMany({
      where: {
        page: pageScope,
        OR: [
          { status: "pending" },
          { status: "snoozed", snoozeUntil: { lte: new Date() } },
        ],
      },
      take: 10,
      orderBy: { createdAt: "desc" },
      select: { action: true, reason: true, confidence: true, page: { select: { slug: true, title: true } } },
    }),
    db.page.findMany({
      where: { orgId: ctx.orgId, dashboardEnabled: true, status: "active" },
      include: {
        versions: { take: 1, orderBy: { createdAt: "desc" }, select: { jsonContent: true } },
        folder: { select: { name: true } },
      },
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

  // Adaptive recently: 1d → 7d → 14d → 30d until ≥3 unique pages
  type VersionRow = typeof recentVersions1d[number];
  function dedupeVersions(versions: VersionRow[]): RecentPageInfo[] {
    const seen = new Set<string>();
    const result: RecentPageInfo[] = [];
    for (const v of versions) {
      if (seen.has(v.pageId)) continue;
      seen.add(v.pageId);
      result.push({
        slug: v.page.slug,
        title: v.page.title,
        folderName: v.page.folder?.name ?? null,
        updatedAt: v.createdAt,
      });
    }
    return result;
  }

  const windowCandidates: Array<{ versions: VersionRow[]; label: string }> = [
    { versions: recentVersions1d, label: "today" },
    { versions: recentVersions7d, label: "this week" },
    { versions: recentVersions14d, label: "past 2 weeks" },
    { versions: recentVersions30d, label: "past 30 days" },
  ];

  let recentPages: RecentPageInfo[] = [];
  let recentWindowLabel = "today";
  for (const { versions, label } of windowCandidates) {
    const deduped = dedupeVersions(versions);
    recentPages = deduped;
    recentWindowLabel = label;
    if (deduped.length >= 3) break;
  }

  // Stale pages
  const stalePages: StalePageInfo[] = allPageMeta
    .filter((p) => p.freshness === "due" || p.freshness === "overdue")
    .map((p) => ({
      slug: p.slug,
      title: p.title,
      staleness: p.freshness as "due" | "overdue",
      reason: p.staleReason,
    }));

  // Open flags
  const flagInfos: FlagInfo[] = pendingFlags.map((f) => ({
    slug: f.page.slug,
    title: f.page.title,
    action: f.action,
    confidence: f.confidence,
    reason: f.reason,
  }));

  // Page-opted dashboard cards
  const dashboardPageInfos: DashboardPageInfo[] = dashboardPages
    .filter((p) => p.versions.length > 0 && p.versions[0].jsonContent)
    .map((p) => {
      const json = p.versions[0].jsonContent as Record<string, unknown>;
      const d = json.dashboard as Record<string, unknown>;
      return {
        slug: p.slug,
        title: p.title,
        subtitle: (json.subtitle as string) ?? null,
        folderName: p.folder?.name ?? null,
        dashboard: {
          prompt: d.prompt as string,
          title: typeof d.title === "string" ? d.title : undefined,
          description: typeof d.description === "string" ? d.description : undefined,
          category: typeof d.category === "string" ? d.category : undefined,
        },
      };
    });

  // Content-writes-per-day buckets for the 30-day activity chart, oldest first.
  const activity = new Array(30).fill(0) as number[];
  for (const v of recentVersions30d) {
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
  for (const v of recentVersions30d) {
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
        activity={activity}
        folders={folders}
        fallbacks={fallbacks}
        recentPages={recentPages}
        recentWindowLabel={recentWindowLabel}
        stalePages={stalePages}
        flagInfos={flagInfos}
        dashboardPageInfos={dashboardPageInfos}
      />
    </Suspense>
  );
}
