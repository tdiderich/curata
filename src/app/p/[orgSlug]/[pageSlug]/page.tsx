import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { readPage, getAnnotations } from "@/lib/pages";
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

export default async function PublicPageView({ params }: Props) {
  const { orgSlug, pageSlug } = await params;

  const org = await db.organization.findUnique({
    where: { slug: orgSlug },
    select: { id: true, name: true, theme: true, mode: true, texture: true, glow: true },
  });
  if (!org) notFound();

  const page = await db.page.findUnique({
    where: { orgId_slug: { orgId: org.id, slug: pageSlug } },
  });
  if (!page || page.visibility !== "public") notFound();

  const pageData = await readPage(org.id, pageSlug);
  if (!pageData) notFound();

  db.page.update({
    where: { id: page.id },
    data: { viewCount: { increment: 1 } },
  }).catch(() => {});

  const user = await resolveCurrentUser();
  const isSignedIn = !!user;

  const rawAnnotations = await getAnnotations(org.id, pageSlug);
  const annotations = rawAnnotations.map((a) => ({
    id: a.id,
    text: a.text,
    author: a.author,
    section: a.section ?? undefined,
    target: a.target ?? undefined,
    added: a.createdAt.toISOString().slice(0, 10),
    status: a.status,
  }));

  const pageTitle = (pageData.json.title as string) || pageSlug;

  return (
    <>
      <ThemeScript theme={org.theme} mode={org.mode} texture={org.texture} glow={org.glow} />
      <div className="public-page">
        <PublicAnnotationClient
          orgSlug={orgSlug}
          pageSlug={pageSlug}
          annotations={annotations}
          isSignedIn={isSignedIn}
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
