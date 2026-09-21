import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AUTH_MODE, resolveOrg } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getChartNode } from "@/lib/chart";
import { ChartNodeDetail } from "@/components/chart-node";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Content chart" };

export default async function ChartNodePage({ params }: { params: Promise<{ term: string[] }> }) {
  const ctx = await resolveOrg();
  if (!ctx) redirect(AUTH_MODE === "clerk" ? "/onboarding" : "/sign-in");
  const { term: parts } = await params;
  const term = parts.map(decodeURIComponent).join("/");
  let node: Awaited<ReturnType<typeof getChartNode>> | null = null;
  let error: string | null = null;
  try {
    node = await getChartNode(ctx.orgId, term);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  return (
    <div className="dash-root">
      <div className="dash-workspace">
        <div className="cmap-nav"><Link href="/chart" className="btn btn--ghost">← Content</Link></div>
        {node ? <ChartNodeDetail node={node} canEdit={can(ctx.role, "page:edit")} /> : <div className="cmap-col-empty">{error}</div>}
      </div>
    </div>
  );
}
