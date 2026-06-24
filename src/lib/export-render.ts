import { createExportNonce } from "@/lib/export-nonce";
import { basePath } from "@/lib/api-fetch";

const PORT = process.env.PORT || "3000";

export function previewUrl(slug: string, orgId: string, hub?: string): string {
  const nonce = createExportNonce(orgId);
  const params = new URLSearchParams({ nonce });
  if (hub) params.set("hub", hub);
  const url = `http://localhost:${PORT}${basePath}/export-preview/${encodeURIComponent(slug)}?${params}`;
  console.error("[export] preview URL:", url);
  return url;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function screenshotPage(url: string, browser: any): Promise<Buffer> {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    document.querySelectorAll(".c-tabs").forEach((tabs) => {
      const buttons = tabs.querySelectorAll(".tab-btn");
      const panels = tabs.querySelectorAll(".tab-panel");
      const frag = document.createDocumentFragment();
      buttons.forEach((btn, i) => {
        const section = document.createElement("div");
        section.className = "export-tab-section";
        const h = document.createElement("div");
        h.className = "export-tab-heading";
        h.textContent = btn.textContent;
        section.appendChild(h);
        if (panels[i]) {
          const panel = panels[i].cloneNode(true) as HTMLElement;
          panel.style.display = "block";
          section.appendChild(panel);
        }
        frag.appendChild(section);
      });
      tabs.innerHTML = "";
      tabs.appendChild(frag);
    });
  });

  const height = await page.evaluate(() => {
    const el = document.querySelector(".export-root");
    if (!el) return document.body.scrollHeight;
    return Math.ceil(el.getBoundingClientRect().bottom) + 48;
  });
  await page.setViewportSize({ width: 1100, height });
  const pngBuffer = await page.screenshot({ fullPage: true });
  await page.close();
  return Buffer.from(pngBuffer);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function renderHtmlToPng(html: string, browser: any): Promise<Buffer> {
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
  return Buffer.from(pngBuffer);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getChromium(): Promise<any> {
  try {
    return (await import("playwright")).chromium;
  } catch (e1) {
    try {
      const { createRequire } = await import("node:module");
      const nativeRequire = createRequire(process.cwd() + "/package.json");
      return nativeRequire("playwright").chromium;
    } catch (e2) {
      console.error("playwright dynamic import failed:", e1);
      console.error("playwright createRequire fallback failed:", e2);
      throw new Error("playwright is not installed — run: npx playwright install chromium");
    }
  }
}
