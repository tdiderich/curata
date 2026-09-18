import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AUTH_MODE, resolveOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDependents, getVocabulary, listConceptMaps, normalizeTerm } from "@/lib/concepts";
import { NewMapForm } from "@/components/new-map-form";

export const dynamic = "force-dynamic";

type Params = { term: string[] };
const termOf = (p: Params) => normalizeTerm(decodeURIComponent(p.term.join("/")));

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  return { title: `Edit ${termOf(await params)}` };
}

/** /map/<term>/edit: the New map form, pre-filled. Unticking detaches. */
export default async function EditMapPage({ params }: { params: Promise<Params> }) {
  const ctx = await resolveOrg();
  if (!ctx) redirect(AUTH_MODE === "clerk" ? "/onboarding" : "/sign-in");
  const term = termOf(await params);

  let data;
  try { data = await getDependents(ctx.orgId, { term }); } catch { redirect(`/map/new?term=${encodeURIComponent(term)}`); }

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
        <div className="cmap-nav"><Link href={`/map/${term}`} className="btn btn--ghost">← {term}</Link></div>
        <div className="cmap">
          <header className="cmap-head">
            <h1 className="cmap-title">Edit map</h1>
            <p className="cmap-summary">Tick what should be on it, untick what should not. Verification history on rows that stay is kept.</p>
          </header>
          <NewMapForm
            pages={pages.map((p) => ({ slug: p.slug, title: p.title, folderName: p.folderId ? folderName.get(p.folderId) ?? null : null }))}
            concepts={vocab.concepts.map((c) => ({ term: c.term, kind: c.kind }))}
            groups={maps.filter((m) => m.term !== term).map((m) => ({ term: m.term, kind: m.kind, needsLook: m.needsLook, total: m.total }))}
            initial={{
              term,
              kind: data.concept?.kind ?? "",
              source: data.asserters[0]?.slug ?? "",
              // Rows pulled in through an include are already covered by
              // that include; only the map's OWN direct edges go here.
              depends: data.dependents.filter((d) => !d.group).map((d) => d.slug),
              external: data.external.filter((e) => !e.group).map((e) => ({ url: e.url, label: e.label, owner: e.owner ?? "" })),
              includes: data.includes.map((i) => i.term),
            }}
          />
        </div>
      </div>
    </div>
  );
}
