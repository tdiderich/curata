import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AUTH_MODE, resolveOrg } from "@/lib/auth";
import { seedOrg } from "@/lib/seed";
import { listPages } from "@/lib/pages";
import { db } from "@/lib/db";
import { DashboardClient, SerializedPageMeta } from "@/components/dashboard-client";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return { title: "Dashboard" };
}

interface FolderRow {
  id: string;
  name: string;
  visibility: string;
  parentId: string | null;
  pageCount: number;
  childFolderCount: number;
}

export default async function DashboardPage() {
  let ctx = await resolveOrg();
  if (!ctx && AUTH_MODE !== "clerk") {
    await seedOrg("curata");
    ctx = await resolveOrg();
  }
  if (!ctx) redirect(AUTH_MODE === "clerk" ? "/onboarding" : "/sign-in");

  const org = await db.organization.findUnique({ where: { id: ctx.orgId }, select: { name: true } });
  const orgName = org?.name ?? "curata";

  const pages = await listPages(ctx.orgId, ctx.userId);

  const rawFolders = await db.folder.findMany({
    where: {
      orgId: ctx.orgId,
      OR: [
        { visibility: "shared" },
        { visibility: "personal", createdBy: ctx.userId },
      ],
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      visibility: true,
      parentId: true,
      _count: { select: { pages: true, children: true } },
    },
  });

  const folders: FolderRow[] = rawFolders.map((f) => ({
    id: f.id,
    name: f.name,
    visibility: f.visibility,
    parentId: f.parentId,
    pageCount: f._count.pages,
    childFolderCount: f._count.children,
  }));


  const serialized: SerializedPageMeta[] = pages.map((p) => ({
    slug: p.slug,
    title: p.title,
    annotationCount: p.annotationCount,
    pendingAnnotationCount: p.pendingAnnotationCount,
    viewCount: p.viewCount,
    updatedAt: p.updatedAt.toISOString(),
    lastActivity: p.lastActivity.toISOString(),
    lastEditedBy: p.lastEditedBy,
    folderId: p.folderId,
    visibility: p.visibility,
    snippet: p.snippet,
    createdBy: p.createdBy,
    sortOrder: p.sortOrder,
    pinned: p.pinned,
    freshness: p.freshness,
  }));

  return (
    <Suspense>
      <DashboardClient
        pages={serialized}
        folders={folders}
        pageCount={pages.length}
        orgName={orgName}
        allowPublic={AUTH_MODE === "clerk" || AUTH_MODE === "oauth"}
      />
    </Suspense>
  );
}
