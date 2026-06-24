import { notFound } from "next/navigation";
import { consumeExportNonce } from "@/lib/export-nonce";
import { readPage } from "@/lib/pages";
import { PageRenderer } from "@/generated/kazam-renderer";

export default async function ExportPreview({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ nonce?: string; hub?: string }>;
}) {
  const { slug } = await params;
  const { nonce, hub: hubSlug } = await searchParams;

  if (!nonce) {
    console.error("[export-preview] no nonce param", { slug });
    notFound();
  }
  const orgId = consumeExportNonce(nonce);
  if (!orgId) {
    console.error("[export-preview] nonce invalid/expired", { slug, nonce: nonce.slice(0, 8) });
    notFound();
  }

  const pageData = await readPage(orgId, slug);
  if (!pageData) {
    console.error("[export-preview] page not found", { orgId, slug });
    notFound();
  }

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

  const page = {
    title: (pageData.json.title as string) || slug,
    subtitle: (pageData.json.subtitle as string) || undefined,
    shell: hubSlug ? "hub" : (pageData.json.shell as string) || "standard",
    hub: effectiveHub,
    components: (pageData.json.components ?? []) as Array<{
      type: string;
      [key: string]: unknown;
    }>,
    slides:
      (pageData.json.slides as Array<{
        label: string;
        hide_label?: boolean;
        cover?: boolean;
        components?: Array<{ type: string; [key: string]: unknown }>;
      }>) || undefined,
  };

  return (
    <div className="main-content">
      <style>{`
        /* Export overrides: show all interactive content */
        .c-tabs .tab-panel { display: block !important; }
        .c-tabs .tab-btn-active { border-color: transparent !important; }
        .c-tabs .tab-btn { opacity: 0.5; }
        .c-tabs .tab-panel + .tab-panel { border-top: 1px solid rgba(255,255,255,0.08); margin-top: 16px; padding-top: 16px; }
      `}</style>
      <div className="page-detail-content export-root">
        <PageRenderer page={page} exportMode={true} />
      </div>
    </div>
  );
}
