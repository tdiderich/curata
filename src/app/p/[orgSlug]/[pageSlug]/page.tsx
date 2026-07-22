import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { resolveCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { readPage, getAnnotations, bumpViewCount } from "@/lib/pages";
import { PageRenderer } from "@/generated/kazam-renderer";
import { ThemeScript } from "@/components/theme-script";
import PublicAnnotationClient from "@/components/public-annotation-client";
import type { Metadata } from "next";

interface Props {
  params: Promise<{ orgSlug: string; pageSlug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { orgSlug, pageSlug } = await params;

  const org = await db.organization.findUnique({
    where: { slug: orgSlug },
    select: { id: true, name: true, theme: true },
  });
  if (!org) return {};

  const page = await db.page.findUnique({
    where: { orgId_slug: { orgId: org.id, slug: pageSlug } },
    select: { title: true, visibility: true },
  });
  if (!page || page.visibility !== "public") return {};

  const title = `${page.title} — ${org.name}`;
  const description = `${page.title} by ${org.name} on curata`;
  const ogTheme = ["dark", "light"].includes(org.theme) ? "violet" : org.theme;

  return {
    title,
    description,
    openGraph: {
      title: page.title,
      description,
      type: "article",
      images: [`/api/og?title=${encodeURIComponent(page.title)}&org=${encodeURIComponent(org.name)}&theme=${ogTheme}`],
    },
    twitter: {
      card: "summary_large_image",
      title: page.title,
      description,
    },
  };
}

export default async function PublicPageView({ params, searchParams }: Props & { searchParams: Promise<{ token?: string }> }) {
  const { orgSlug, pageSlug } = await params;
  const { token: shareToken } = await searchParams;

  const org = await db.organization.findUnique({
    where: { slug: orgSlug },
    select: { id: true, name: true, theme: true, mode: true, texture: true, glow: true },
  });
  if (!org) notFound();

  const page = await db.page.findUnique({
    where: { orgId_slug: { orgId: org.id, slug: pageSlug } },
  });
  if (!page) notFound();

  if (page.visibility !== "public") {
    if (!shareToken) notFound();
    const { resolvePageAccess } = await import("@/lib/access");
    const access = await resolvePageAccess(page, null, null, shareToken);
    if (!access) notFound();
  }

  const pageData = await readPage(org.id, pageSlug);
  if (!pageData) notFound();

  bumpViewCount(page.id).catch(() => {});

  const user = await resolveCurrentUser();
  const isSignedIn = !!user;

  const rawAnnotations = await getAnnotations(org.id, pageSlug);
  const annotations = rawAnnotations.map((a) => ({
    id: a.id,
    text: a.text,
    author: a.author,
    section: a.section ?? undefined,
    target: a.target ?? undefined,
    kind: a.kind,
    added: a.createdAt.toISOString().slice(0, 10),
    status: a.status,
    slide: a.slide ?? undefined,
    visibility: a.visibility ?? undefined,
  }));

  const pageTitle = (pageData.json.title as string) || pageSlug;

  // Pack pages get a "try it" install banner: the pack: marker means this page
  // is installable with one kazam command against its public /p/ URL.
  const isPack =
    page.visibility === "public" &&
    !!pageData.json.pack &&
    typeof pageData.json.pack === "object";
  let installCmd: string | null = null;
  if (isPack) {
    const h = await headers();
    const host = h.get("host") ?? "";
    const proto = host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
    installCmd = `kazam install ${proto}://${host}/p/${orgSlug}/${pageSlug}`;
  }

  return (
    <>
      <ThemeScript theme={org.theme} mode={org.mode} texture={org.texture} glow={org.glow} />
      <div className="public-page">
        <PublicAnnotationClient
          orgSlug={orgSlug}
          pageSlug={pageSlug}
          annotations={annotations}
          isSignedIn={isSignedIn}
          printFlow={(pageData.json.print_flow as string) || undefined}
          shell={(pageData.json.shell as string) || "standard"}
        >
          <div className="page-detail-content">
            {(pageData.json.shell as string) !== "deck" && (
              <div className="c-header">
                <h1 className="c-header-title">{pageTitle}</h1>
                {typeof pageData.json.subtitle === "string" && (
                  <p className="c-header-subtitle">{pageData.json.subtitle}</p>
                )}
              </div>
            )}
            {installCmd && (
              <div className="pack-install-banner">
                <span className="pack-install-label">Install this pack</span>
                <code className="pack-install-cmd">{installCmd}</code>
              </div>
            )}
            <PageRenderer
              page={{
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
              }}
            />
          </div>
        </PublicAnnotationClient>
        <div className="public-page-footer">
          Powered by <Link href="/" className="public-page-footer-link">curata</Link>
        </div>
      </div>
    </>
  );
}
