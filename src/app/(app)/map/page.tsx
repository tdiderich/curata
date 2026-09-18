import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AUTH_MODE, resolveOrg } from "@/lib/auth";
import { listConceptMaps } from "@/lib/concepts";
import { ConceptMapIndex } from "@/components/concept-map-index";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Map" };

export default async function MapIndexPage() {
  const ctx = await resolveOrg();
  if (!ctx) redirect(AUTH_MODE === "clerk" ? "/onboarding" : "/sign-in");
  const rows = await listConceptMaps(ctx.orgId);
  return (
    <div className="dash-root">
      <div className="dash-workspace">
        <div className="cmap-nav">
          <Link href="/dashboard" className="btn btn--ghost">← Home</Link>
        </div>
        <ConceptMapIndex rows={rows} />
      </div>
    </div>
  );
}
