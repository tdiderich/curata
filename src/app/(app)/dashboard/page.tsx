import type { Metadata } from "next";
import { AUTH_MODE, resolveOrg } from "@/lib/auth";
import { seedOrg, seedOrgContent } from "@/lib/seed";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getVocabulary } from "@/lib/concepts";
import { basePath } from "@/lib/api-fetch";
import { ActionBarHome } from "@/components/action-bar-home";
import type { ActionBarFolder, ActionBarPage } from "@/components/action-bar-types";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return { title: "Home" };
}

export default async function DashboardPage() {
  let ctx = await resolveOrg();
  if (!ctx && AUTH_MODE !== "clerk") {
    await seedOrg("curata");
    ctx = await resolveOrg();
  }
  if (!ctx) redirect(AUTH_MODE === "clerk" ? "/onboarding" : "/sign-in");

  await seedOrgContent(ctx.orgId);

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

  const folderVisFilter = AUTH_MODE === "none"
    ? { orgId: ctx.orgId }
    : {
        orgId: ctx.orgId,
        OR: [
          { visibility: { in: ["org", "shared"] } },
          { visibility: "private", createdBy: ctx.userId },
        ],
      };

  const pageVisFilter = AUTH_MODE === "none"
    ? { orgId: ctx.orgId, status: { not: "archived" } }
    : {
        orgId: ctx.orgId,
        status: { not: "archived" },
        OR: [
          { createdBy: ctx.userId },
          { shares: { some: { userId: ctx.userId } } },
          { visibility: { in: ["org", "public", "shared"] } },
        ],
      };

  const [vocab, rawFolders, rawPages, org, qaFolder] = await Promise.all([
    getVocabulary(),
    db.folder.findMany({
      where: folderVisFilter,
      orderBy: { name: "asc" },
      select: { id: true, name: true, parentId: true, visibility: true, locked: true },
    }),
    db.page.findMany({
      where: pageVisFilter,
      orderBy: { title: "asc" },
      select: { slug: true, title: true, folderId: true, pinned: true, visibility: true, updatedAt: true },
    }),
    db.organization.findUnique({
      where: { id: ctx.orgId },
      select: { name: true, logoUrl: true, logoMime: true, updatedAt: true },
    }),
    db.folder.findFirst({
      where: { orgId: ctx.orgId, name: "Quick Actions", locked: true },
      select: { rules: true },
    }),
  ]);

  // Quick action refs live in the QA folder's rules JSON as a non-rule entry
  // (see /api/quick-actions). Only surface refs the viewer can actually see.
  const visibleSlugs = new Set(rawPages.map((p) => p.slug));
  const quickRefs: string[] = (() => {
    const rules = qaFolder?.rules;
    if (!Array.isArray(rules)) return [];
    const entry = rules.find(
      (r) => typeof r === "object" && r !== null && (r as Record<string, unknown>).id === "quick-refs"
    ) as Record<string, unknown> | undefined;
    if (!entry || !Array.isArray(entry.refs)) return [];
    return entry.refs.filter((s): s is string => typeof s === "string" && visibleSlugs.has(s));
  })();

  const orgName = org?.name || "curata";
  const logoUrl = org?.logoMime
    ? `${basePath}/api/org-logo?v=${org.updatedAt.getTime()}`
    : (org?.logoUrl ?? null);

  return (
    <ActionBarHome
      vocabulary={vocab}
      folders={rawFolders as ActionBarFolder[]}
      pages={rawPages.map((p) => ({ ...p, updatedAt: p.updatedAt.toISOString() })) as ActionBarPage[]}
      orgName={orgName}
      logoUrl={logoUrl}
      quickRefs={quickRefs}
    />
  );
}
