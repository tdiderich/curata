import { createExportNonce } from "@/lib/export-nonce";
import { basePath } from "@/lib/api-fetch";

const PORT = process.env.PORT || "3000";
const EXPORT_WIDTH = 800;

export async function previewUrl(slug: string, orgId: string, hub?: string): Promise<string> {
  const nonce = await createExportNonce(orgId, slug, hub);
  const params = new URLSearchParams({ nonce });
  if (hub) params.set("hub", hub);
  return `http://localhost:${PORT}${basePath}/export-preview/${encodeURIComponent(slug)}?${params}`;
}

function measureContent(): { width: number; height: number } {
  document.documentElement.style.overflow = "hidden";
  document.querySelectorAll("nextjs-portal, [data-nextjs-toast], #__next-build-indicator").forEach(el => (el as HTMLElement).style.display = "none");
  const root = document.querySelector(".export-root");
  if (!root) return { width: document.body.scrollWidth, height: document.body.scrollHeight };

  let maxRight = 0;
  for (const child of root.querySelectorAll("*")) {
    const r = child.getBoundingClientRect();
    if (r.width > 0 && r.right > maxRight) maxRight = r.right;
  }

  const rootRect = root.getBoundingClientRect();
  const pad = 16;
  return {
    width: Math.ceil(Math.max(maxRight, rootRect.right) + pad),
    height: Math.ceil(rootRect.bottom) + pad,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function screenshotPage(url: string, browser: any): Promise<Buffer> {
  const page = await browser.newPage({ viewport: { width: EXPORT_WIDTH, height: 800 } });
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

  const bounds = await page.evaluate(measureContent);
  await page.setViewportSize({ width: bounds.width, height: bounds.height });
  const pngBuffer = await page.screenshot({ clip: { x: 0, y: 0, width: bounds.width, height: bounds.height } });
  await page.close();
  return Buffer.from(pngBuffer);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function renderHtmlToPng(html: string, browser: any): Promise<Buffer> {
  const page = await browser.newPage({ viewport: { width: EXPORT_WIDTH, height: 800 } });
  await page.setContent(html, { waitUntil: "load" });
  await page.waitForTimeout(300);

  const bounds = await page.evaluate(measureContent);
  await page.setViewportSize({ width: bounds.width, height: bounds.height });
  const pngBuffer = await page.screenshot({ clip: { x: 0, y: 0, width: bounds.width, height: bounds.height } });
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
