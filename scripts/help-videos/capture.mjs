// Capture the Storybook screens a help video needs, plus the boxes its rings
// point at.
//
//   node scripts/help-videos/capture.mjs <beats.yaml> <outdir> [storybook-url]
//
// For each beat with `story:`, renders that story in Chrome at 2x, runs its
// optional `steps` (clicks and typing) to reach the right state, and saves
// <outdir>/<beat id>.png. A beat's `ring` ({ css } or { text }) is measured
// in the same page and written to <outdir>/targets.json in CSS pixels.
// Fails loudly on page errors or a ring target that isn't on screen, so a UI
// change that breaks a video breaks the build instead of shipping stale.
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { chromium } from "playwright";

const [beatsPath, outDir, base = "http://localhost:6006"] = process.argv.slice(2);
if (!beatsPath || !outDir) {
  console.error("usage: node capture.mjs <beats.yaml> <outdir> [storybook-url]");
  process.exit(2);
}

const spec = yaml.load(fs.readFileSync(beatsPath, "utf8"));
const [W, H] = spec.size ?? [1440, 900];
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 2,
  timezoneId: "America/Chicago",
  locale: "en-US",
  reducedMotion: "reduce",
});

const targets = {};
let failed = 0;

for (const beat of spec.beats) {
  if (!beat.story) continue;
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    // Storybook probes for a favicon and similar; only real errors count.
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  // Skip first-run UI (welcome auto-open) and keep the dock in its default state.
  await page.addInitScript(() => {
    try {
      localStorage.setItem("curata:help-welcome-seen", "1");
      localStorage.removeItem("curata:dock-expanded");
    } catch {}
  });
  await page.goto(`${base}/iframe.html?id=${beat.story}&viewMode=story`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  // Optional steps to reach the state: { click: "<visible label>" },
  // { css: "<selector to click>" }, or { type: "<text>" } into the focused field.
  for (const step of beat.steps ?? []) {
    try {
      if (step.click) await page.getByRole("button", { name: step.click, exact: true }).or(page.getByText(step.click, { exact: true })).first().click({ timeout: 5000 });
      else if (step.css) await page.locator(step.css).first().click({ timeout: 5000 });
      else if (step.type) await page.keyboard.type(step.type, { delay: 10 });
      // { select: "<visible text>" }: triple-click to select that paragraph,
      // which opens the page's Comment popup.
      else if (step.select) {
        // Retry: under load the first triple-click can land before the
        // popup's handler is ready.
        for (let i = 0; i < 3; i++) {
          await page.getByText(step.select).first().click({ clickCount: 3, timeout: 5000 });
          if (await page.locator(".selection-popup").first().waitFor({ state: "visible", timeout: 1500 }).then(() => true, () => false)) break;
          await page.waitForTimeout(800);
        }
      }
      // { scrollTo: "<css>" }: scroll that element to the top of its scroller,
      // { offset } px below the top (default 24).
      else if (step.scrollTo) {
        await page.locator(step.scrollTo).first().evaluate((el, off) => {
          el.scrollIntoView({ block: "start" });
          let p = el.parentElement;
          while (p && p.scrollHeight <= p.clientHeight) p = p.parentElement;
          (p ?? document.scrollingElement)?.scrollBy(0, -off);
        }, step.offset ?? 24);
      }
      // { replaceText: [from, to] }: rewrite visible text, e.g. Storybook's
      // localhost origin to the public one in a URL the screen prints.
      else if (step.replaceText) {
        await page.evaluate(([from, to]) => {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            if (n.nodeValue.includes(from)) n.nodeValue = n.nodeValue.split(from).join(to);
          }
        }, step.replaceText);
      }
    } catch (err) {
      console.error(`  ${beat.id}: step ${JSON.stringify(step)} failed: ${String(err).split("\n")[0]}`);
      failed++;
    }
    await page.waitForTimeout(700);
  }
  // Park the mouse off-screen so hover-only UI doesn't leak into the shot.
  await page.mouse.move(W - 1, 1);
  await page.waitForTimeout(250);

  if (beat.ring) {
    const loc = beat.ring.css ? page.locator(beat.ring.css).first() : page.getByText(beat.ring.text, { exact: true }).first();
    const box = await loc.boundingBox().catch(() => null);
    if (!box || box.width === 0 || box.y > H) {
      console.error(`  ${beat.id}: ring target ${JSON.stringify(beat.ring)} not on screen`);
      failed++;
    } else {
      targets[beat.id] = { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) };
    }
  }

  await page.screenshot({ path: path.join(outDir, `${beat.id}.png`) });
  if (errors.length) {
    console.error(`  ${beat.id}: ${errors.length} page error(s):\n    ${errors.slice(0, 5).join("\n    ")}`);
    failed++;
  }
  console.log(`captured ${beat.id} <- ${beat.story}`);
  await page.close();
}

fs.writeFileSync(path.join(outDir, "targets.json"), JSON.stringify(targets, null, 2));
await browser.close();
if (failed) {
  console.error(`${failed} problem(s); fix the stories or the beats before rendering`);
  process.exit(1);
}
