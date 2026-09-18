import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AUTH_MODE, resolveOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { getVocabulary, listConceptMaps } from "@/lib/concepts";
import { NewMapForm } from "@/components/new-map-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New map" };

export default async function NewMapPage({ searchParams }: { searchParams: Promise<{ term?: string }> }) {
  const ctx = await resolveOrg();
  if (!ctx) redirect(AUTH_MODE === "clerk" ? "/onboarding" : "/sign-in");
  const sp = await searchParams;
  const [pages, folders, vocab, maps] = await Promise.all([
    db.page.findMany({
      where: { orgId: ctx.orgId, status: { not: "archived" }, seeded: false },
      orderBy: { title: "asc" },
      select: { slug: true, title: true, folderId: true },
    }),
    db.folder.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true } }),
    getVocabulary(),
    listConceptMaps(ctx.orgId),
  ]);
  const folderName = new Map(folders.map((f) => [f.id, f.name]));
  return (
    <div className="dash-root">
      <div className="dash-workspace">
        <div className="cmap-nav"><Link href="/map" className="btn btn--ghost">← Map</Link></div>
        <div className="cmap">
          <header className="cmap-head">
            <h1 className="cmap-title">New map</h1>
            <p className="cmap-summary">Start from the change. Pick what has to be looked at when it happens. The map does the remembering.</p>
          </header>
          <NewMapForm
            pages={pages.map((p) => ({ slug: p.slug, title: p.title, folderName: p.folderId ? folderName.get(p.folderId) ?? null : null }))}
            concepts={vocab.concepts.map((c) => ({ term: c.term, kind: c.kind }))}
            groups={maps.map((m) => ({ term: m.term, kind: m.kind, needsLook: m.needsLook, total: m.total }))}
            initialTerm={sp.term ?? ""}
          />
        </div>
      </div>
    </div>
  );
}
