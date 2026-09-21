import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AUTH_MODE, resolveOrg } from "@/lib/auth";
import { NewNodeForm } from "@/components/chart-new-node";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New top level content" };

export default async function NewNodePage() {
  const ctx = await resolveOrg();
  if (!ctx) redirect(AUTH_MODE === "clerk" ? "/onboarding" : "/sign-in");
  return (
    <div className="dash-root">
      <div className="dash-workspace">
        <div className="cmap-nav"><Link href="/chart" className="btn btn--ghost">← Content</Link></div>
        <div className="cmap">
          <header className="cmap-head">
            <h1 className="cmap-title">New top level content item</h1>
            <p className="cmap-summary">Name the thing, point at the page that owns the truth for it, and list what depends on it. When that page changes, everything under it needs a look.</p>
          </header>
          <NewNodeForm />
        </div>
      </div>
    </div>
  );
}
