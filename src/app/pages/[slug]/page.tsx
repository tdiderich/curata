import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { resolveOrg, AUTH_MODE } from "@/lib/auth";
import { getAnnotations, getPageSections, readPage } from "@/lib/pages";
import { PageRenderer } from "@/generated/kazam-renderer";
import PageDetailClient from "@/components/page-detail-client";
import PageEditor from "@/components/page-editor";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const ctx = await resolveOrg();
  if (!ctx) return { title: "curata" };
  const { slug } = await params;
  const pageData = await readPage(ctx.orgId, slug);
  const pageTitle = pageData ? (pageData.json.title as string) || slug : slug;
  return { title: pageTitle };
}

export default async function PageDetailView({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const ctx = await resolveOrg();
  if (!ctx) redirect("/sign-in");

  const { slug } = await params;
  const { edit } = await searchParams;
  const isEditing = edit === "1";

  const pageData = await readPage(ctx.orgId, slug);
  if (!pageData) notFound();

  const pageTitle = (pageData.json.title as string) || slug;

  if (isEditing) {
    return (
      <>
        <div className="site-bar">
          <Link className="site-bar-back" href={`/pages/${slug}`}>
            &larr; Back to preview
          </Link>
        </div>
        <PageEditor
          slug={slug}
          initial={{
            title: (pageData.json.title as string) || "",
            shell: (pageData.json.shell as string) || "standard",
            subtitle: (pageData.json.subtitle as string) || undefined,
            components: (pageData.json.components ?? []) as Array<{
              type: string;
              [key: string]: unknown;
            }>,
          }}
          contentHash={pageData.contentHash}
        />
      </>
    );
  }

  const rawAnnotations = await getAnnotations(ctx.orgId, slug);
  const annotations = rawAnnotations.map((a) => ({
    id: a.id,
    text: a.text,
    author: a.author,
    section: a.section ?? undefined,
    target: a.target ?? undefined,
    kind: (a.kind === "edit" ? "edit" : a.kind === "note" ? "note" : undefined) as
      | "note"
      | "edit"
      | undefined,
    replacement: a.replacement ?? undefined,
    added: a.createdAt.toISOString().slice(0, 10),
    status: a.status,
    source: a.source,
  }));
  const sections = await getPageSections(ctx.orgId, slug);

  const page = {
    title: pageTitle,
    subtitle: (pageData.json.subtitle as string) || undefined,
    shell: (pageData.json.shell as string) || "standard",
    components: (pageData.json.components ?? []) as Array<{
      type: string;
      [key: string]: unknown;
    }>,
    slides: (pageData.json.slides as Array<{
      label: string;
      hide_label?: boolean;
      cover?: boolean;
      components?: Array<{ type: string; [key: string]: unknown }>;
    }>) || undefined,
    freshness: pageData.json.freshness as { updated?: string; review_every?: string; owner?: string; expires?: string } | "never" | undefined,
  };

  return (
    <>
      <PageDetailClient
        slug={slug}
        annotations={annotations}
        sections={sections}
        pageTitle={pageTitle}
        orgSlug={ctx.orgSlug}
        isPublic={pageData.visibility === "public"}
        autoConnect={slug === "getting-started"}
        authMode={AUTH_MODE}
      >
        <div className="page-detail-content">
          {page.shell !== "deck" && (
            <div className="c-header">
              <h1 className="c-header-title">{page.title}</h1>
              {page.subtitle && (
                <p className="c-header-subtitle">{page.subtitle}</p>
              )}
            </div>
          )}
          <PageRenderer page={page} />
        </div>
      </PageDetailClient>
    </>
  );
}
