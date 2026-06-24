import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/auth";
import { readPage } from "@/lib/pages";
import { getOrgTheme } from "@/lib/theme";
import { buildTitlePageHtml, buildAppendixHtml } from "@/lib/export";
import {
  getChromium,
  previewUrl,
  screenshotPage,
  renderHtmlToPng,
} from "@/lib/export-render";

function ts(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}_${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function addPngPage(doc: any, pngBuffer: Buffer) {
  const img = await doc.embedPng(pngBuffer);
  const { width, height } = img.scale(1);
  const targetWidth = 612;
  const scale = targetWidth / width;
  const targetHeight = height * scale;
  const page = doc.addPage([targetWidth, targetHeight]);
  page.drawImage(img, { x: 0, y: 0, width: targetWidth, height: targetHeight });
}

export async function GET(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const slug = request.nextUrl.searchParams.get("slug");
  const format = request.nextUrl.searchParams.get("format") ?? "png";
  const hub = request.nextUrl.searchParams.get("hub") ?? undefined;

  if (!slug) return NextResponse.json({ error: "slug is required" }, { status: 400 });
  if (format !== "png" && format !== "pdf") {
    return NextResponse.json({ error: "format must be png or pdf" }, { status: 400 });
  }

  const pageData = await readPage(ctx.orgId, slug);
  if (!pageData) return NextResponse.json({ error: "page not found" }, { status: 404 });

  let chromium;
  try {
    chromium = await getChromium();
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 501 });
  }

  const browser = await chromium.launch();
  let pngBuffer: Buffer;
  try {
    const url = previewUrl(slug, ctx.orgId, hub);
    pngBuffer = await screenshotPage(url, browser);
  } catch (err) {
    console.error("export render error:", err);
    await browser.close();
    return NextResponse.json({ error: "render failed" }, { status: 500 });
  }
  await browser.close();

  if (format === "pdf") {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    doc.setTitle(slug);
    await addPngPage(doc, pngBuffer);
    const pdfBytes = await doc.save();
    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${slug}_${ts()}.pdf"`,
      },
    });
  }

  return new NextResponse(new Uint8Array(pngBuffer), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="${slug}_${ts()}.png"`,
    },
  });
}

export async function POST(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json()) as {
    slugs?: string[];
    title?: string;
    subtitle?: string;
    generatedDate?: string;
    hub?: string;
  };

  const { slugs, title, subtitle, hub } = body;

  if (!Array.isArray(slugs) || slugs.length === 0) {
    return NextResponse.json({ error: "slugs must be a non-empty array" }, { status: 400 });
  }

  let chromium;
  try {
    chromium = await getChromium();
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 501 });
  }

  const theme = await getOrgTheme(ctx.orgId);

  const date = body.generatedDate
    ? new Date(body.generatedDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const pageTitles: string[] = [];
  for (const slug of slugs) {
    const pageData = await readPage(ctx.orgId, slug);
    if (!pageData) return NextResponse.json({ error: `page not found: ${slug}` }, { status: 404 });
    pageTitles.push(((pageData.json as { title?: string }).title) ?? slug);
  }

  const reportTitle = title ?? "Report";
  const titlePageHtml = buildTitlePageHtml(reportTitle, subtitle, date, slugs.length, pageTitles, theme);
  const appendixHtml = buildAppendixHtml(pageTitles, slugs, theme);

  const browser = await chromium.launch();
  try {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    doc.setTitle(reportTitle);

    const titlePng = await renderHtmlToPng(titlePageHtml, browser);
    await addPngPage(doc, titlePng);

    for (const slug of slugs) {
      const url = previewUrl(slug, ctx.orgId, hub);
      const contentPng = await screenshotPage(url, browser);
      await addPngPage(doc, contentPng);
    }

    const appendixPng = await renderHtmlToPng(appendixHtml, browser);
    await addPngPage(doc, appendixPng);

    await browser.close();

    const pdfBytes = await doc.save();
    const reportName = reportTitle
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${reportName}_${ts()}.pdf"`,
      },
    });
  } catch (err) {
    await browser.close();
    console.error("export render error:", err);
    return NextResponse.json({ error: "render failed" }, { status: 500 });
  }
}
