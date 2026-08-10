import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AUTH_MODE, resolveOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { CleanupClient, type ArchivedRow } from "@/components/cleanup-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Cleanup" };

export default async function CleanupPage() {
  const ctx = await resolveOrg();
  if (!ctx) redirect(AUTH_MODE === "clerk" ? "/onboarding" : "/sign-in");

  const archivedVisFilter = AUTH_MODE === "none"
    ? { orgId: ctx.orgId, status: "archived" }
    : {
        orgId: ctx.orgId,
        status: "archived",
        OR: [
          { createdBy: ctx.userId },
          { shares: { some: { userId: ctx.userId } } },
          { visibility: { in: ["org", "public", "shared"] } },
        ],
      };

  const rawArchived = await db.page.findMany({
    where: archivedVisFilter,
    orderBy: { updatedAt: "desc" },
    select: { slug: true, title: true, updatedAt: true, folder: { select: { name: true } } },
  });

  const archived: ArchivedRow[] = rawArchived.map((p) => ({
    slug: p.slug,
    title: p.title,
    folderName: p.folder?.name ?? null,
    updatedAt: p.updatedAt.toISOString(),
  }));

  return <CleanupClient initialArchived={archived} />;
}
