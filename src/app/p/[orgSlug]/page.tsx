import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { ThemeScript } from "@/components/theme-script";
import type { Metadata } from "next";

interface Props {
  params: Promise<{ orgSlug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { orgSlug } = await params;
  const org = await db.organization.findUnique({
    where: { slug: orgSlug },
    select: { name: true },
  });
  if (!org) return {};

  return {
    title: `${org.name} — curata`,
    description: `Public knowledge base for ${org.name}`,
    openGraph: {
      title: org.name,
      description: `Public knowledge base for ${org.name}`,
      type: "website",
    },
    twitter: { card: "summary" },
  };
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function OrgPublicIndex({ params }: Props) {
  const { orgSlug } = await params;

  const org = await db.organization.findUnique({
    where: { slug: orgSlug },
    select: { id: true, name: true, theme: true, mode: true, texture: true, glow: true },
  });
  if (!org) notFound();

  const pages = await db.page.findMany({
    where: { orgId: org.id, visibility: "public" },
    orderBy: { updatedAt: "desc" },
    select: { slug: true, title: true, updatedAt: true, viewCount: true },
  });

  return (
    <>
      <ThemeScript theme={org.theme} mode={org.mode} texture={org.texture} glow={org.glow} />
      <div className="dash-root">
        <div className="dash-workspace-header dash-workspace-header--top">
          <span className="dash-workspace-label">{org.name}</span>
          <span className="dash-workspace-count">
            {pages.length} page{pages.length !== 1 ? "s" : ""}
          </span>
        </div>

        {pages.length === 0 ? (
          <div className="dash-empty">
            <div className="dash-empty-icon">
              <img
                src="/illustrations/deep-work.svg"
                alt=""
                style={{ width: 160, opacity: 0.8 }}
              />
            </div>
            <div className="dash-empty-title">No public pages yet</div>
            <div className="dash-empty-text">
              This organization hasn&apos;t published any pages.
            </div>
          </div>
        ) : (
          <div className="pub-grid">
            {pages.map((page) => (
              <Link
                key={page.slug}
                href={`/p/${orgSlug}/${page.slug}`}
                className="pub-card"
              >
                <span className="pub-card-title">{page.title}</span>
                <span className="pub-card-meta">
                  Updated {formatDate(page.updatedAt)}
                  {page.viewCount > 0 && ` · ${page.viewCount} view${page.viewCount !== 1 ? "s" : ""}`}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
