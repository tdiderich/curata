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
  const [totalPages, updated30d, pendingAnnotations] = await Promise.all([
    db.page.count({ where: pageScope }),
    db.page.count({ where: { ...pageScope, updatedAt: { gte: monthAgo } } }),
    db.annotation.count({ where: { page: { orgId: ctx.orgId }, status: "pending" } }),
  ]);

  const stats: GlanceStat[] = [
    { label: "pages", value: String(totalPages) },
    { label: "updated last 30d", value: String(updated30d) },
    { label: "untouched >30d", value: String(totalPages - updated30d) },
    { label: "open annotations", value: String(pendingAnnotations) },
  ];

  if (!home) {
    // ensureHomePage only fails on a write/validation error; surface a plain
    // empty state rather than a broken glance.
    return <div className="dash-root">Could not load the workspace home page.</div>;
  }

  return (
    <Suspense>
      <HomeGlance json={home.json} updatedAt={home.updatedAt} origin={origin} stats={stats} />
    </Suspense>
  );
}
