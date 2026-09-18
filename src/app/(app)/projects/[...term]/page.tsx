import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AUTH_MODE, resolveOrg } from "@/lib/auth";
import { getProject } from "@/lib/projects";
import { ProjectDetail } from "@/components/project-detail";

export const dynamic = "force-dynamic";

type Params = { term: string[] };
const termOf = (p: Params) => decodeURIComponent(p.term.join("/"));

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  return { title: termOf(await params) };
}

/** /projects/<term>: one project's own tracked items plus each included sub-map's, read-only there. */
export default async function ProjectDetailPage({ params }: { params: Promise<Params> }) {
  const ctx = await resolveOrg();
  if (!ctx) redirect(AUTH_MODE === "clerk" ? "/onboarding" : "/sign-in");
  const term = termOf(await params);

  let project;
  try {
    project = await getProject(ctx.orgId, term);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return (
      <div className="dash-root">
        <div className="dash-workspace">
          <div className="cmap-nav"><Link href="/projects" className="btn btn--ghost">← Projects</Link></div>
          <div className="dash-empty">{message}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="dash-root">
      <div className="dash-workspace">
        <div className="cmap-nav"><Link href="/projects" className="btn btn--ghost">← Projects</Link></div>
        <ProjectDetail project={project} />
      </div>
    </div>
  );
}
