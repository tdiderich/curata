import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AUTH_MODE, resolveOrg } from "@/lib/auth";
import { CleanupClient } from "@/components/cleanup-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Cleanup" };

export default async function CleanupPage() {
  const ctx = await resolveOrg();
  if (!ctx) redirect(AUTH_MODE === "clerk" ? "/onboarding" : "/sign-in");

  return <CleanupClient />;
}
