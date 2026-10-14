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

/**
 * Opens everything a reader would otherwise click to see, so the export shows
 * it. Works on DOM state alone (drop `hidden`, set aria-expanded), so it holds
 * whether the renderer leaves closed panels out, marks them `hidden` in React,
 * or ships them open and lets a script hide them. Runs inside the browser via
 * page.evaluate, so it must stay self-contained.
 *
 * - tier_summary: every tier's account panel open.
 * - next_steps: every account row expanded.
 * - journey_track: the timeline, with the full Details log under it.
 */
export function expandInteractive(): void {
  const open = (el: Element) => el.removeAttribute("hidden");

  document.querySelectorAll("[data-tier-summary]").forEach((root) => {
    root.querySelectorAll("[data-tier-toggle]").forEach((btn) => {
      btn.setAttribute("aria-expanded", "true");
      btn.classList.add("is-open");
    });
    root.querySelectorAll("[data-tier-panel]").forEach(open);
  });

  document.querySelectorAll("[data-next-steps]").forEach((root) => {
    root.querySelectorAll("[data-acct-toggle]").forEach((btn) => {
      btn.setAttribute("aria-expanded", "true");
      btn.closest("[data-acct]")?.classList.add("is-open");
      const panel = btn.getAttribute("aria-controls");
      const el = panel ? root.querySelector(`[id="${panel}"]`) : null;
      if (el) open(el);
    });
  });

  document.querySelectorAll(".c-journey").forEach((root) => {
    root.querySelectorAll("[data-jt-panel]").forEach((panel) => {
      open(panel);
      const el = panel as HTMLElement;
      if (panel.getAttribute("data-jt-panel") === "details") {
        el.classList.remove("has-more");
        el.style.maxHeight = "none";
        el.style.overflow = "visible";
        el.style.marginTop = "16px";
      }
    });
    // Both views are on the page now, so the switcher has nothing to switch.
    root.querySelectorAll(".c-jt-toggle").forEach((t) => ((t as HTMLElement).style.display = "none"));
  });
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

  await page.evaluate(expandInteractive);

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
