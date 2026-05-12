import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { resolveOrg } from "@/lib/auth";
import { seedOrg } from "@/lib/seed";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dashboard — curata" };
import { listPages } from "@/lib/pages";
import { db } from "@/lib/db";
import { DashboardClient, SerializedPageMeta } from "@/components/dashboard-client";

interface FolderRow {
  id: string;
  name: string;
  visibility: string;
}

export default async function DashboardPage() {
  let ctx = await resolveOrg();
  if (!ctx) {
    await seedOrg("curata");
    ctx = await resolveOrg();
  }
  if (!ctx) redirect("/sign-in");

  const pages = await listPages(ctx.orgId, ctx.userId);

  const folders: FolderRow[] = await db.folder.findMany({
    where: {
      orgId: ctx.orgId,
      OR: [
        { visibility: "shared" },
        { visibility: "personal", createdBy: ctx.userId },
      ],
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, visibility: true },
  });


  const serialized: SerializedPageMeta[] = pages.map((p) => ({
    slug: p.slug,
    title: p.title,
    annotationCount: p.annotationCount,
    viewCount: p.viewCount,
    updatedAt: p.updatedAt.toISOString(),
    lastActivity: p.lastActivity.toISOString(),
    folderId: p.folderId,
    visibility: p.visibility,
    snippet: p.snippet,
    createdBy: p.createdBy,
  }));

  return (
    <DashboardClient
      pages={serialized}
      folders={folders}
      pageCount={pages.length}
    />
  );
}
