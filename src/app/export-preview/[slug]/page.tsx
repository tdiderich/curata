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

  if (!nonce) notFound();
  const orgId = consumeExportNonce(nonce);
  if (!orgId) notFound();

  const pageData = await readPage(orgId, slug);
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
        .export-tab-section { margin-bottom: 24px; }
        .export-tab-heading {
          font-size: 15px; font-weight: 600; letter-spacing: 0.5px;
          text-transform: uppercase; color: rgba(255,255,255,0.5);
          padding: 10px 0; margin-bottom: 8px;
          border-bottom: 1px solid rgba(255,255,255,0.08);
        }
      `}</style>
      <div className="page-detail-content export-root">
        <PageRenderer page={page} exportMode={true} />
      </div>
    </div>
  );
}
