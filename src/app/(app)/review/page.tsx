import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AUTH_MODE, resolveOrg } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getReviewQueue } from "@/lib/pages";
import { canApproveBatch } from "@/lib/approval";
import { ReviewQueueClient } from "@/components/review-queue-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Review queue" };

export default async function ReviewQueuePage() {
  const ctx = await resolveOrg();
  if (!ctx) redirect(AUTH_MODE === "clerk" ? "/onboarding" : "/sign-in");

  const rows = await getReviewQueue(ctx.orgId, ctx.userId);
  const canTrust = can(ctx.role, "page:edit");

  const eligibility = canTrust
    ? await canApproveBatch(ctx.orgId, ctx.userId, ctx.role, rows.map((r) => r.slug))
    : new Map();

  const serialized = rows.map((r) => ({
    slug: r.slug,
    title: r.title,
    folderId: r.folderId,
    folderName: r.folderName,
    latestEditedBy: r.latestEditedBy,
    latestUpdatedAt: r.latestUpdatedAt.toISOString(),
    neverTrusted: r.neverTrusted,
    versionsBehind: r.versionsBehind,
    sinceUnapprovedAt: r.sinceUnapprovedAt.toISOString(),
    concepts: r.concepts,
    createdByMe: r.createdByMe,
    annotatedByMe: r.annotatedByMe,
    eligible: eligibility.get(r.slug)?.eligible ?? true,
    approversNote: eligibility.get(r.slug)?.restrictionNote ?? null,
  }));

  return <ReviewQueueClient rows={serialized} canTrust={canTrust} />;
}
