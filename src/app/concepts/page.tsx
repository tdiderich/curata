import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AUTH_MODE, resolveOrg } from "@/lib/auth";
import { getSemanticMap } from "@/lib/concepts";
import { ConceptExplorer } from "@/components/concept-explorer";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return { title: "Concepts" };
}

export default async function ConceptsPage() {
  const ctx = await resolveOrg();
  if (!ctx) redirect(AUTH_MODE === "clerk" ? "/onboarding" : "/sign-in");

  const map = await getSemanticMap();

  return (
    <ConceptExplorer
      concepts={map.concepts}
      links={map.links}
      stats={map.stats}
    />
  );
}
