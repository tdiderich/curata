import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { AUTH_MODE, resolveOrg } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { readPage } from "@/lib/pages";
import { resolveRules } from "@/lib/content-rules";
import {
  resolveEffectiveTrustMode,
  parseTrustRule,
} from "@/lib/approval";
import { getPageConcepts, normalizeTerm } from "@/lib/concepts";
import { DEFAULT_TAGS } from "@/lib/default-tags";
import { SettingsTabs, SettingsSection } from "@/components/settings";
import { PageSettingsGeneral } from "@/components/page-settings-general";
import { PageSettingsTags } from "@/components/page-settings-tags";
import { ContentRulesEditor } from "@/components/content-rules-editor";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const ctx = await resolveOrg();
  if (!ctx) return { title: "Settings" };
  const { slug } = await params;
  const pageData = await readPage(ctx.orgId, slug);
  const pageTitle = pageData ? (pageData.json.title as string) || slug : slug;
  return { title: `${pageTitle} settings` };
}

export default async function PageSettingsView({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const ctx = await resolveOrg();
  if (!ctx) redirect("/sign-in");

  const { slug } = await params;

  const pageData = await readPage(ctx.orgId, slug, "latest");
  if (!pageData) notFound();

  const pageRow = await db.page.findUnique({
    where: { orgId_slug: { orgId: ctx.orgId, slug } },
    select: { id: true, folderId: true, rules: true, trustedVersionId: true, createdAt: true, pageType: true },
  });
  if (!pageRow) notFound();

  const pageTitle = (pageData.json.title as string) || slug;
  const pageType = pageRow.pageType ?? undefined;

  const canEditPage = can(ctx.role, "page:edit");
  const folders = await db.folder.findMany({
    where: {
      orgId: ctx.orgId,
      OR: [{ visibility: "org" }, { visibility: "private", createdBy: ctx.userId }],
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  let folderName: string | undefined;
  if (pageRow.folderId) {
    const folder = await db.folder.findUnique({ where: { id: pageRow.folderId }, select: { name: true } });
    folderName = normalizeTerm(folder?.name ?? "") || undefined;
  }

  const { inherited: inheritedRules, page: pageRules } = await resolveRules(ctx.orgId, pageRow.folderId, pageRow.rules);

  const trustResolved = await resolveEffectiveTrustMode(ctx.orgId, pageRow.folderId, pageRow.rules);
  const trustMode = trustResolved.mode;
  const hasTrustRuleAtScope = parseTrustRule(pageRow.rules) !== null;

  const pageTags: Array<{ term: string; kind: string }> = [];
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
  const tagOptions = [...optionMap.entries()].map(([term, kind]) => ({ term, kind }));

  const trustStatusLabel = trustMode === "auto"
    ? "Auto-trusted: every save is immediately trusted, no approval step."
    : !pageRow.trustedVersionId
      ? "Never trusted: no version of this page has been approved yet."
      : pageData.trustedBehind
        ? "Behind: a newer version is waiting on approval."
        : "Trusted: the latest version is the approved one.";

  const tabs = [
    {
      label: "General",
      content: (
        <PageSettingsGeneral
          slug={slug}
          visibility={pageData.visibility}
          authMode={AUTH_MODE}
          folderId={pageRow.folderId}
          folders={folders}
          canEdit={canEditPage}
        />
      ),
    },
    {
      label: "Tags",
      content: (
        <PageSettingsTags
          pageId={pageRow.id}
          initialTags={pageTags}
          tagOptions={tagOptions}
          canEdit={canEditPage}
          folderTag={folderName}
        />
      ),
    },
    {
      label: "Rules",
      content: (
        <SettingsSection
          title="Rules"
          description="Trust mode, approval, and content rules for this page."
        >
          <ContentRulesEditor
            scopeParam={`scope=page:${slug}`}
            initialRules={pageRules.map(({ id, text, mode, patterns }) => ({ id, text, mode, patterns }))}
            canManage={canEditPage}
            inheritedRules={inheritedRules}
            trustMode={trustMode}
            hasTrustRuleAtScope={hasTrustRuleAtScope}
            trustStatusLabel={trustStatusLabel}
          />
        </SettingsSection>
      ),
    },
  ];

  return (
    <>
      <div className="dash-root">
        <div className="dash-workspace">
          <SettingsTabs tabs={tabs} />
          <div style={{ display: "flex", justifyContent: "center", padding: "32px 0" }}>
            <Link href={`/pages/${slug}`} className="btn btn--ghost">
              Return to page
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
