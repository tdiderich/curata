import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/auth";
import { readPage } from "@/lib/pages";
import { getOrgTheme } from "@/lib/theme";
import { renderPageHtml, buildTitlePageHtml, buildAppendixHtml } from "@/lib/export";

class PlaywrightMissingError extends Error {
  constructor() {
    super("playwright is not installed — run: npx playwright install chromium");
    this.name = "PlaywrightMissingError";
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getChromium(): Promise<any> {
  try {
    return (await import("playwright")).chromium;
  } catch {
    throw new PlaywrightMissingError();
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function renderHtmlToPng(html: string, browser?: any): Promise<Buffer> {
  const ownBrowser = !browser;
  if (!browser) {
    const chromium = await getChromium();
    browser = await chromium.launch();
  }

  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  await page.setContent(html, { waitUntil: "load" });
  await page.waitForTimeout(300);

  const height = await page.evaluate(() => {
    const el = document.querySelector(".export-root");
    if (!el) return document.body.scrollHeight;
    return Math.ceil(el.getBoundingClientRect().bottom) + 48;
  });
  await page.setViewportSize({ width: 1100, height });
  const pngBuffer = await page.screenshot({ fullPage: true });
  await page.close();

  if (ownBrowser) await browser.close();
  return Buffer.from(pngBuffer);
}

async function pngToPdf(pngBuffer: Buffer, title?: string): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  if (title) doc.setTitle(title);
  await addPngPage(doc, pngBuffer);
  return doc.save();
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

  if (!slug) return NextResponse.json({ error: "slug is required" }, { status: 400 });
  if (format !== "png" && format !== "pdf") {
    return NextResponse.json({ error: "format must be png or pdf" }, { status: 400 });
  }

  const pageData = await readPage(ctx.orgId, slug);
  if (!pageData) return NextResponse.json({ error: "page not found" }, { status: 404 });

  const theme = await getOrgTheme(ctx.orgId);
  const html = await renderPageHtml(pageData.json, theme);

  let pngBuffer: Buffer;
  try {
    pngBuffer = await renderHtmlToPng(html);
  } catch (err) {
    if (err instanceof PlaywrightMissingError) {
      return NextResponse.json({ error: err.message }, { status: 501 });
    }
    console.error("export render error:", err);
    return NextResponse.json({ error: "render failed" }, { status: 500 });
  }

  if (format === "pdf") {
    const pdfBytes = await pngToPdf(pngBuffer, slug);
    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${slug}.pdf"`,
      },
    });
  }

  return new NextResponse(new Uint8Array(pngBuffer), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="${slug}.png"`,
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
  };

  const { slugs, title, subtitle } = body;

  if (!Array.isArray(slugs) || slugs.length === 0) {
    return NextResponse.json({ error: "slugs must be a non-empty array" }, { status: 400 });
  }

  let chromium: Awaited<typeof import("playwright")>["chromium"];
  try {
    chromium = await getChromium();
  } catch (err) {
    if (err instanceof PlaywrightMissingError) {
      return NextResponse.json({ error: err.message }, { status: 501 });
    }
    throw err;
  }

  const theme = await getOrgTheme(ctx.orgId);

  const date = body.generatedDate
    ? new Date(body.generatedDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const pages: Array<{ slug: string; html: string; pageTitle: string }> = [];
  for (const slug of slugs) {
    const pageData = await readPage(ctx.orgId, slug);
    if (!pageData) return NextResponse.json({ error: `page not found: ${slug}` }, { status: 404 });
    const html = await renderPageHtml(pageData.json, theme);
    const pageTitle = ((pageData.json as { title?: string }).title) ?? slug;
    pages.push({ slug, html, pageTitle });
  }

  const pageTitles = pages.map((p) => p.pageTitle);
  const reportTitle = title ?? "Report";

  const titlePageHtml = buildTitlePageHtml(reportTitle, subtitle, date, pages.length, pageTitles, theme);
  const appendixHtml = buildAppendixHtml(pageTitles, slugs, theme);

  const browser = await chromium.launch();
  try {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    doc.setTitle(reportTitle);

    // Title page
    const titlePng = await renderHtmlToPng(titlePageHtml, browser);
    await addPngPage(doc, titlePng);

    // Content pages
    for (const { html } of pages) {
      const contentPng = await renderHtmlToPng(html, browser);
      await addPngPage(doc, contentPng);
    }

    // Appendix
    const appendixPng = await renderHtmlToPng(appendixHtml, browser);
    await addPngPage(doc, appendixPng);

    await browser.close();

    const pdfBytes = await doc.save();
    const reportName = reportTitle
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${reportName}.pdf"`,
      },
    });
  } catch (err) {
    await browser.close();
    console.error("export render error:", err);
    return NextResponse.json({ error: "render failed" }, { status: 500 });
  }
}
