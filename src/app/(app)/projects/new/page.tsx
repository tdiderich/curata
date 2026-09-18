import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AUTH_MODE, resolveOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { listConceptMaps } from "@/lib/concepts";
import { NewProjectForm } from "@/components/new-project-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New project" };

export default async function NewProjectPage() {
  const ctx = await resolveOrg();
  if (!ctx) redirect(AUTH_MODE === "clerk" ? "/onboarding" : "/sign-in");
  const [pages, folders, maps] = await Promise.all([
    db.page.findMany({
      where: { orgId: ctx.orgId, status: { not: "archived" }, seeded: false },
      orderBy: { title: "asc" },
      select: { slug: true, title: true, folderId: true },
    }),
    db.folder.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true } }),
    listConceptMaps(ctx.orgId),
  ]);
  const folderName = new Map(folders.map((f) => [f.id, f.name]));
  return (
    <div className="dash-root">
      <div className="dash-workspace">
        <div className="cmap-nav"><Link href="/projects" className="btn btn--ghost">← Projects</Link></div>
        <div className="cmap">
          <header className="cmap-head">
            <h1 className="cmap-title">New project</h1>
            <p className="cmap-summary">A map tells you what might go stale. A project is the run where you actually do the work and check it off.</p>
          </header>
          <NewProjectForm
            pages={pages.map((p) => ({ slug: p.slug, title: p.title, folderName: p.folderId ? folderName.get(p.folderId) ?? null : null }))}
            templates={maps.map((m) => ({ term: m.term, kind: m.kind, total: m.total, needsLook: m.needsLook }))}
          />
        </div>
      </div>
    </div>
  );
}
