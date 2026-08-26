import { notFound } from "next/navigation";
import { consumeExportNonce } from "@/lib/export-nonce";
import { readPage } from "@/lib/pages";
import { getOrgTheme } from "@/lib/theme";
import { ThemeScript } from "@/components/theme-script";
import { PageRenderer } from "@/generated/kazam-renderer";
import { expandComponentRefs, expandSlideRefs, renderedRefWrap } from "@/lib/component-refs";

export default async function ExportPreview({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ nonce?: string; hub?: string }>;
}) {
  const { slug } = await params;
  const { nonce, hub: hubSlug } = await searchParams;

  if (!nonce) notFound();
  const consumed = await consumeExportNonce(nonce);
  if (!consumed) notFound();
  // The nonce is only valid for the slug (and hub, if any) it was minted
  // for — a nonce minted for one page must not unlock a different one, even
  // within the same org.
  if (consumed.slug !== slug) notFound();
  if (consumed.hub && consumed.hub !== hubSlug) notFound();
  const orgId = consumed.orgId;

  const [pageData, theme] = await Promise.all([
    readPage(orgId, slug),
    getOrgTheme(orgId),
  ]);
  if (!pageData) notFound();

  type HubShape = {
    name: string;
    eyebrow?: string;
    status?: string;
    status_color?: string;
    pages?: Array<{ label: string; href: string }>;
  };
  let effectiveHub = pageData.json.hub as HubShape | undefined;
  if (hubSlug && hubSlug !== slug) {
    const hubPageData = await readPage(orgId, hubSlug);
    const externalHub = hubPageData?.json.hub as HubShape | undefined;
    if (externalHub) {
      const hubParam = `hub=${encodeURIComponent(hubSlug)}`;
      effectiveHub = {
        ...externalHub,
        pages: externalHub.pages?.map((p) => ({
          ...p,
          href: p.href.includes("hub=")
            ? p.href
            : `${p.href}${p.href.includes("?") ? "&" : "?"}${hubParam}`,
        })),
      };
    }
  }

  // Export is only reachable via a nonce minted for an org member who
  // already had access to `slug` (see previewUrl/consumeExportNonce) — treat
  // the viewer as any org member in good standing for ref expansion, on the
  // same "latest" channel readPage used above.
  const refCtx = {
    orgId,
    channel: "latest" as const,
    viewer: { userId: null, orgMemberRole: "member" },
    ...renderedRefWrap((refSlug: string) => `/pages/${refSlug}`),
  };
  const expandedComponents = await expandComponentRefs(
    pageData.json.components as Array<Record<string, unknown>> | undefined,
    refCtx
  );
  // Deck slides carry a second components tree — same expansion, same ctx.
  const rawSlides = pageData.json.slides as Array<{
    label: string;
    hide_label?: boolean;
    cover?: boolean;
    components?: Array<{ type: string; [key: string]: unknown }>;
  }> | undefined;
  const expandedSlides = Array.isArray(rawSlides)
    ? await expandSlideRefs(rawSlides as Array<Record<string, unknown>>, refCtx)
    : undefined;

  const page = {
    title: (pageData.json.title as string) || slug,
    subtitle: (pageData.json.subtitle as string) || undefined,
    shell: hubSlug ? "hub" : (pageData.json.shell as string) || "standard",
    hub: effectiveHub,
    components: expandedComponents as Array<{
      type: string;
      [key: string]: unknown;
    }>,
    slides: expandedSlides as Array<{
      label: string;
      hide_label?: boolean;
      cover?: boolean;
      components?: Array<{ type: string; [key: string]: unknown }>;
    }> | undefined,
  };

  return (
    <div className="main-content">
      <ThemeScript theme={theme.theme} mode={theme.mode} texture={theme.texture} glow={theme.glow} />
      <style>{`
        .export-tab-section { margin-bottom: 24px; }
        .export-tab-heading {
          font-size: 15px; font-weight: 600; letter-spacing: 0.5px;
          text-transform: uppercase; color: rgba(255,255,255,0.5);
          padding: 10px 0; margin-bottom: 8px;
          border-bottom: 1px solid rgba(255,255,255,0.08);
        }
        html { overflow: hidden !important; }
        [data-nextjs-dialog-overlay],
        [data-nextjs-toast],
        nextjs-portal,
        #__next-build-indicator,
        .__next-build-watcher { display: none !important; }
        body::before, body::after {
          position: absolute !important;
          min-height: 100% !important;
        }
        .export-root {
          background: transparent !important;
          padding: 32px 28px !important;
        }
        .export-title-block {
          text-align: center;
          padding: 24px 28px 20px;
          border-bottom: 1px solid rgba(255,255,255,0.08);
          margin-bottom: 8px;
        }
        .export-title-block h1 {
          font-size: 22px;
          font-weight: 700;
          color: var(--snow);
          margin: 0 0 4px;
          line-height: 1.3;
        }
        .export-title-block p {
          font-size: 14px;
          color: rgba(255,255,255,0.5);
          margin: 0;
        }
      `}</style>
      <div className="page-detail-content export-root">
        <div className="export-title-block">
          <h1>{page.title}</h1>
          {page.subtitle && <p>{page.subtitle}</p>}
        </div>
        <PageRenderer page={page} exportMode={true} />
      </div>
    </div>
  );
}
