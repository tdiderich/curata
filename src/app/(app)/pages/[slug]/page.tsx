import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { resolveOrg, AUTH_MODE } from "@/lib/auth";
import { getAnnotations, getPageSections, readPage, bumpViewCount } from "@/lib/pages";
import { db } from "@/lib/db";
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
  searchParams: Promise<{ edit?: string; hub?: string }>;
}) {
  const ctx = await resolveOrg();
  if (!ctx) redirect("/sign-in");

  const { slug } = await params;
  const { edit, hub: hubSlug } = await searchParams;
  const isEditing = edit === "1";

  const pageData = await readPage(ctx.orgId, slug);
  if (!pageData) notFound();

  const pageRow = await db.page.findUnique({
    where: { orgId_slug: { orgId: ctx.orgId, slug } },
    select: { id: true, status: true, supersededBy: true, updatedAt: true },
  });
  if (pageRow) bumpViewCount(pageRow.id).catch(() => {});

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

  type HubShape = { name: string; eyebrow?: string; status?: string; status_color?: string; pages?: Array<{ label: string; href: string }> };
  let effectiveHub = pageData.json.hub as HubShape | undefined;
  let hubContext: string | undefined;
  if (hubSlug && hubSlug !== slug) {
    const hubPageData = await readPage(ctx.orgId, hubSlug);
    const externalHub = hubPageData?.json.hub as HubShape | undefined;
    if (externalHub) {
      effectiveHub = externalHub;
      hubContext = hubSlug;
    }
  }

  const page = {
    title: pageTitle,
    subtitle: (pageData.json.subtitle as string) || undefined,
    shell: effectiveHub ? "hub" : (pageData.json.shell as string) || "standard",
    hub: effectiveHub,
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
        printFlow={(pageData.json.print_flow as string) || undefined}
        archived={pageRow?.status === "archived"
          ? { since: pageRow.updatedAt.toISOString().slice(0, 10), supersededBy: pageRow.supersededBy }
          : undefined}
      >
        <div className="page-detail-content">
          <PageRenderer
            page={page}
            activeHubHref={slug}
            resolveHubHref={hubContext
              ? (href: string) => `${href}?hub=${encodeURIComponent(hubContext!)}`
              : undefined}
          />
        </div>
      </PageDetailClient>
    </>
  );
}
