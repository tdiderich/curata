import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import { resolveOrg, AUTH_MODE } from "@/lib/auth";
import { getAnnotations, getPageSections, readPage, bumpViewCount } from "@/lib/pages";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { resolveRules } from "@/lib/content-rules";
import type { ResolvedRule } from "@/lib/content-rules";
import { canApprove, getApprovers, describeApprovalRule, parseApprovalRules } from "@/lib/approval";
import type { ApprovalApprover } from "@/lib/approval";
import { PageRenderer } from "@/generated/kazam-renderer";
import PageDetailClient from "@/components/page-detail-client";
import { PageTags } from "@/components/page-tags";
import { getPageConcepts, normalizeTerm } from "@/lib/concepts";
import { DEFAULT_TAGS } from "@/lib/default-tags";
import { expandComponentRefs, renderedRefWrap } from "@/lib/component-refs";

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
  searchParams: Promise<{ hub?: string; latest?: string }>;
}) {
  const ctx = await resolveOrg();
  if (!ctx) redirect("/sign-in");

  const { slug } = await params;
  const { hub: hubSlug, latest: latestParam } = await searchParams;
  // Viewers see the trusted (human-approved) version by default — the whole
  // point of the approval gate. ?latest=1 previews the newest, unapproved
  // version without changing what anyone else sees.
  const previewingLatest = latestParam === "1";
  const channel = previewingLatest ? "latest" : "trusted";

  const pageData = await readPage(ctx.orgId, slug, channel);
  if (!pageData) notFound();

  const pageRow = await db.page.findUnique({
    where: { orgId_slug: { orgId: ctx.orgId, slug } },
    select: { id: true, status: true, supersededBy: true, updatedAt: true, folderId: true, rules: true },
  });
  if (pageRow) bumpViewCount(pageRow.id).catch(() => {});

  const canManageRules = can(ctx.role, "rules:manage");
  const canEditPage = can(ctx.role, "page:edit");
  let inheritedRules: ResolvedRule[] = [];
  let pageRules: ResolvedRule[] = [];
  if (pageRow) {
    const resolved = await resolveRules(ctx.orgId, pageRow.folderId, pageRow.rules);
    inheritedRules = resolved.inherited;
    pageRules = resolved.page;
  }

  // Approval eligibility: page:edit is still the floor (viewers never get an
  // approve button); an approval rule further narrows who among editors can
  // click it. No rule anywhere in the cascade means the pre-existing
  // behavior stands — any editor can approve.
  let approvalEligible = true;
  let approversNote: string | null = null;
  let pageApprovers: ApprovalApprover[] | null = null;
  if (pageRow) {
    approvalEligible = await canApprove(ctx.orgId, ctx.userId, ctx.role, slug);
    const resolvedApprovers = await getApprovers(ctx.orgId, slug);
    if (resolvedApprovers) {
      approversNote = await describeApprovalRule(ctx.orgId, resolvedApprovers.rule);
    }
    const pageLevelRule = parseApprovalRules(pageRow.rules)[0];
    pageApprovers = pageLevelRule ? pageLevelRule.approvers : null;
  }
  const canApproveEffective = canEditPage && approvalEligible;

  const pageTitle = (pageData.json.title as string) || slug;

  const pageTags: Array<{ term: string; kind: string }> = [];
  let tagOptions: Array<{ term: string; kind: string }> = [];
  let folderTag: string | undefined;
  if (pageRow?.folderId) {
    const folder = await db.folder.findUnique({
      where: { id: pageRow.folderId },
      select: { name: true },
    });
    folderTag = normalizeTerm(folder?.name ?? "") || undefined;
  }
  if (pageRow) {
    const [concepts, orgConcepts] = await Promise.all([
      getPageConcepts(pageRow.id),
      db.concept.findMany({
        where: { pages: { some: { page: { orgId: ctx.orgId, status: "active" } } } },
        select: { displayName: true, kind: true },
        take: 200,
      }),
    ]);
    const seen = new Set<string>();
    for (const c of concepts) {
      const term = normalizeTerm(c.term);
      if (!term || seen.has(term)) continue;
      seen.add(term);
      pageTags.push({ term, kind: c.kind });
    }
    const optionMap = new Map<string, string>(DEFAULT_TAGS.map((t) => [t, ""]));
    for (const c of orgConcepts) {
      const term = normalizeTerm(c.displayName);
      if (term) optionMap.set(term, c.kind);
    }
    tagOptions = [...optionMap.entries()].map(([term, kind]) => ({ term, kind }));
  }

  const rawAnnotations = await getAnnotations(ctx.orgId, slug);
  const annotations = rawAnnotations.map((a) => ({
    id: a.id,
    text: a.text,
    author: a.author,
    section: a.section ?? undefined,
    target: a.target ?? undefined,
    kind: (a.kind === "edit" ? "edit" : a.kind === "talking_point" ? "talking_point" : "note") as
      | "note"
      | "edit"
      | "talking_point",
    replacement: a.replacement ?? undefined,
    added: a.createdAt.toISOString().slice(0, 10),
    status: a.status,
    source: a.source,
    slide: a.slide ?? undefined,
    visibility: a.visibility ?? undefined,
  }));
  const sections = await getPageSections(ctx.orgId, slug, channel);

  type HubShape = { name: string; eyebrow?: string; status?: string; status_color?: string; pages?: Array<{ label: string; href: string }> };
  let effectiveHub = pageData.json.hub as HubShape | undefined;
  let hubContext: string | undefined;
  if (hubSlug && hubSlug !== slug) {
    const hubPageData = await readPage(ctx.orgId, hubSlug);
    const externalHub = hubPageData?.json.hub as HubShape | undefined;
    if (externalHub) {
      const hubParam = `hub=${encodeURIComponent(hubSlug)}`;
      effectiveHub = {
        ...externalHub,
        pages: externalHub.pages?.map((p) => ({
          ...p,
          href: p.href.includes("hub=") ? p.href : `${p.href}${p.href.includes("?") ? "&" : "?"}${hubParam}`,
        })),
      };
      hubContext = hubSlug;
    }
  }

  if (!hubContext && effectiveHub?.pages) {
    effectiveHub = {
      ...effectiveHub,
      pages: effectiveHub.pages.map((p) => ({
        ...p,
        href: p.href === slug ? p.href : `${p.href}?hub=${slug}`,
      })),
    };
  }

  // Expand `type: ref` shared-component blocks before this tree ever reaches
  // PageRenderer — the single server-side choke point for this surface.
  // Channel-aware (same channel the page itself is being read on), re-checks
  // the viewer's access to the referenced page, and never leaks content the
  // viewer can't see.
  const expandedComponents = await expandComponentRefs(
    pageData.json.components as Array<Record<string, unknown>> | undefined,
    {
      orgId: ctx.orgId,
      channel,
      viewer: { userId: ctx.userId, orgMemberRole: ctx.role },
      ...renderedRefWrap((refSlug) => `/pages/${refSlug}`),
    }
  );

  const page = {
    title: pageTitle,
    subtitle: (pageData.json.subtitle as string) || undefined,
    shell: hubContext ? "hub" : (pageData.json.shell as string) || "standard",
    hub: effectiveHub,
    components: expandedComponents as Array<{
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
        visibility={pageData.visibility}
        autoConnect={slug === "getting-started"}
        authMode={AUTH_MODE}
        printFlow={(pageData.json.print_flow as string) || undefined}
        shell={hubContext ? "hub" : (pageData.json.shell as string) || "standard"}
        inheritedRules={inheritedRules}
        pageRules={pageRules}
        pageSlug={slug}
        canManageRules={canManageRules}
        canEditPageRules={canEditPage}
        pageApprovers={pageApprovers}
        approvalEffectiveNote={approversNote}
        archived={pageRow?.status === "archived"
          ? { since: pageRow.updatedAt.toISOString().slice(0, 10), supersededBy: pageRow.supersededBy }
          : undefined}
        trustBanner={{
          trusted: pageData.trusted,
          trustedBehind: pageData.trustedBehind,
          previewingLatest,
          canApprove: canApproveEffective,
          approversNote,
        }}
        tagsRow={
          pageRow ? (
            <PageTags
              pageId={pageRow.id}
              initialTags={pageTags}
              tagOptions={tagOptions}
              canEdit={canEditPage}
              pickerViaPalette
              maxVisible={5}
              folderTag={folderTag}
            />
          ) : undefined
        }
      >
        <div className="page-detail-content">
          <PageRenderer
            page={page}
            activeHubHref={hubContext ? `${slug}?hub=${encodeURIComponent(hubContext)}` : slug}
            resolveHubHref={undefined}
          />
        </div>
      </PageDetailClient>
    </>
  );
}
