// Build a HyperFrames project for one help video from its beats file and the
// captures made by capture.mjs.
//
//   node scripts/help-videos/build.mjs <beats.yaml> <capdir> <projectdir>
//
// Then, in <projectdir>:  npx --yes hyperframes@0.8.77 render -o renders/raw.mp4
//
// Curata branding: the app's dark tokens (violet accent), Inter for text,
// and the C-and-dot mark. Beats are data; edit the YAML, not the output.
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const [beatsPath, capDir, projDir] = process.argv.slice(2);
if (!beatsPath || !capDir || !projDir) {
  console.error("usage: node build.mjs <beats.yaml> <capdir> <projectdir>");
  process.exit(2);
}

const spec = yaml.load(fs.readFileSync(beatsPath, "utf8"));
const targets = JSON.parse(fs.readFileSync(path.join(capDir, "targets.json"), "utf8"));
const [SW, SH] = spec.size ?? [1440, 900];

// Canvas and window geometry (1080p). The caption sits above the window so
// it's the first thing a viewer reads; the window fills the rest.
const CW = 1920, CH = 1080;
const BAR = 34;
const CAP_Y = 34;
const WX = (CW - SW) / 2, WY = CH - 36 - (SH + BAR);
const XF = 0.35; // crossfade seconds
const INTRO = 1.8;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const MARK = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" aria-hidden="true">
  <path d="M 24.43 8.93 A 11 11 0 1 0 24.43 23.07" stroke="#AB7FBB" stroke-width="3.5" stroke-linecap="round"/>
  <circle cx="27.2" cy="16" r="3.4" fill="#D9C9E6"/></svg>`;

// Bundled open fonts (OFL) so renders are identical on any machine.
const FONTS_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), "fonts");
const FONT_FACES = [
  ["Inter", 500, "inter-latin-500-normal.woff2"],
  ["Inter", 600, "inter-latin-600-normal.woff2"],
  ["Inter", 700, "inter-latin-700-normal.woff2"],
  ["JetBrains Mono", 400, "jetbrains-mono-latin-400-normal.woff2"],
];

const CSS = `
${FONT_FACES.map(([fam, w, file]) => `  @font-face { font-family: "${fam}"; font-weight: ${w}; src: url("assets/fonts/${file}") format("woff2"); }`).join("\n")}
  :root { --bg:#121113; --surface:#201F21; --snow:#F7F7F2; --muted:#6E726C; --light:#B0B3AD; --accent:#AB7FBB; --accent-rgb:171,127,187; --text-rgb:247,247,242; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${CW}px; height: ${CH}px; background: var(--bg); overflow: hidden; }
  body { font-family: "Inter", sans-serif; font-weight: 500; color: var(--snow); -webkit-font-smoothing: antialiased; }
  .mono { font-family: "JetBrains Mono", monospace; font-weight: 400; }
  #stage { position: absolute; inset: 0; }
  .glow { position: absolute; border-radius: 50%; pointer-events: none; filter: blur(10px); }
  .glow.a { width: 1300px; height: 760px; left: 310px; top: -420px; background: radial-gradient(ellipse at center, rgba(var(--accent-rgb),0.16) 0%, transparent 65%); }
  .glow.b { width: 900px; height: 700px; right: -300px; bottom: -380px; background: radial-gradient(ellipse at center, rgba(var(--accent-rgb),0.10) 0%, transparent 65%); }
  .win { position: absolute; left: ${WX}px; top: ${WY}px; width: ${SW}px; height: ${SH + BAR}px; border-radius: 14px; overflow: hidden;
         border: 1px solid rgba(var(--text-rgb),0.12); background: var(--bg); box-shadow: 0 30px 80px rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.3); }
  .bar { height: ${BAR}px; display: flex; align-items: center; gap: 8px; padding: 0 14px; background: #1a191b; border-bottom: 1px solid rgba(var(--text-rgb),0.08); }
  .dot { width: 11px; height: 11px; border-radius: 50%; background: rgba(var(--text-rgb),0.16); }
  .bar-title { flex: 1; text-align: center; margin-right: 52px; font-size: 13px; color: var(--light); font-weight: 500; }
  .content { position: relative; width: ${SW}px; height: ${SH}px; }
  .shot { position: absolute; left: 0; top: 0; width: ${SW}px; height: ${SH}px; }
  .ring { position: absolute; border: 2px solid rgba(var(--accent-rgb),0.95); border-radius: 10px;
          box-shadow: 0 0 0 6px rgba(var(--accent-rgb),0.16), 0 0 28px rgba(var(--accent-rgb),0.35); }
  .term { position: absolute; inset: 0; background: #0e0d0f; padding: 60px 64px; font-size: 27px; line-height: 1.8; }
  .line { white-space: pre; }
  .prompt { color: #C9A6D6; }
  .typed { display: inline-block; vertical-align: bottom; overflow: hidden; white-space: pre; color: var(--snow); }
  .out { color: var(--light); white-space: pre-wrap; }
  .out .ok { color: #9fc48b; }
  .line.wrap { white-space: normal; display: flex; gap: 0; }
  .line.wrap .prompt { flex-shrink: 0; white-space: pre; }
  .pasted { color: var(--snow); }
  .card .note { font-size: 24px; color: var(--light); max-width: 1100px; text-align: center; line-height: 1.45; }
  .caption { position: absolute; left: 0; width: ${CW}px; top: ${CAP_Y}px; text-align: center; font-size: 32px; font-weight: 600; letter-spacing: -0.01em; color: var(--snow); }
  .card { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 26px; }
  .card h1 { font-size: 64px; font-weight: 700; letter-spacing: -0.02em; }
  .card p { font-size: 28px; color: var(--light); }
  .code { padding: 20px 30px; border-radius: 12px; background: var(--surface); border: 1px solid rgba(var(--accent-rgb),0.45); font-size: 25px; color: var(--snow); }
  .brand { display: flex; align-items: center; gap: 14px; font-size: 40px; font-weight: 600; letter-spacing: -0.01em; }
`;

// Lay beats on a timeline.
let t = INTRO;
const beats = spec.beats.map((b, i) => {
  const at = t;
  t += b.seconds;
  return { ...b, at, end: t, last: i === spec.beats.length - 1 };
});
const DURATION = +(t + 0.6).toFixed(2);

const body = [];
const js = [];
const a = (s) => js.push("      " + s);

body.push('<div class="glow a"></div><div class="glow b"></div>');

// Intro card.
body.push(`<div class="card h" id="intro" data-layout-allow-overlap><div class="brand">${MARK(64)}<span>curata</span></div><p>${esc(spec.title)}</p></div>`);
a(`tl.fromTo("#intro", { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.5, ease: E }, 0.1);`);
a(`tl.to("#intro", { opacity: 0, duration: ${XF}, ease: "none" }, ${INTRO - XF});`);

// Story beats each get a window; terminal beats share one terminal window that
// keeps its history, like a real session.
const termBeats = beats.filter((b) => b.terminal);
let termOpenAt = null, termCloseAt = null;
if (termBeats.length) {
  termOpenAt = termBeats[0].at;
  termCloseAt = termBeats[termBeats.length - 1].end;
  const lines = [];
  let inSession = false;
  termBeats.forEach((b) => {
    // Shell commands start with `claude `; anything else is typed to the agent,
    // so the first one opens a `claude` session.
    const agentTurn = !b.terminal.typed.startsWith("claude ");
    const launches = agentTurn && !inSession;
    if (launches) {
      inSession = true;
      lines.push(`<div class="line h" id="${b.id}-launch"><span class="prompt">$ </span><span>claude</span></div>`);
    }
    const n = b.terminal.typed.length;
    // `paste: true` drops long prompts in at once (wrapped) instead of typing.
    const paste = !!b.terminal.paste;
    const inner = paste
      ? `<span class="pasted" id="${b.id}-typed">${esc(b.terminal.typed)}</span>`
      : `<span class="typed" id="${b.id}-typed" style="width:0ch">${esc(b.terminal.typed)}</span>`;
    lines.push(`<div class="line h${paste ? " wrap" : ""}" id="${b.id}-in"><span class="prompt">${agentTurn ? "&gt; " : "$ "}</span>${inner}</div>`);
    // Lines that report a write get the success color.
    const out = b.terminal.output.trimEnd().split("\n")
      .map((l) => esc(l).replace(/^(Created|Added|Saved)( [^:"]*)?/, '<span class="ok">$1$2</span>'))
      .join("\n");
    lines.push(`<div class="out h" id="${b.id}-out">${out}</div>`);
    const typeStart = b.at + 0.5;
    const typeDur = paste ? 0.25 : Math.min(2.0, Math.max(0.8, n * 0.03));
    if (launches) a(`tl.set("#${b.id}-launch", { opacity: 1 }, ${(b.at + 0.05).toFixed(2)});`);
    a(`tl.set("#${b.id}-in", { opacity: 1 }, ${(b.at + 0.3).toFixed(2)});`);
    if (paste) a(`tl.fromTo("#${b.id}-typed", { opacity: 0 }, { opacity: 1, duration: ${typeDur}, ease: "none" }, ${typeStart.toFixed(2)});`);
    else a(`tl.fromTo("#${b.id}-typed", { width: "0ch" }, { width: "${n}ch", duration: ${typeDur.toFixed(2)}, ease: "steps(${n})" }, ${typeStart.toFixed(2)});`);
    const outAt = typeStart + typeDur + (b.terminal.think ?? 0.45);
    a(`tl.fromTo("#${b.id}-out", { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.35, ease: E }, ${outAt.toFixed(2)});`);
  });
  body.push(`<div class="win h" id="win-term" data-layout-allow-overlap><div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="bar-title">Terminal</span></div>
  <div class="content"><div class="term mono">${lines.join("\n")}</div></div></div>`);
  a(`tl.to("#win-term", { opacity: 1, duration: ${XF}, ease: "none" }, ${(termOpenAt - XF / 2).toFixed(2)});`);
}

for (const b of beats) {
  if (b.story) {
    const ring = targets[b.id];
    const ringHtml = ring
      ? `<div class="ring h" id="${b.id}-ring" style="left:${ring.x - 12}px;top:${ring.y - 5}px;width:${ring.w + 24}px;height:${ring.h + 10}px"></div>`
      : "";
    body.push(`<div class="win h" id="win-${b.id}" data-layout-allow-overlap><div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="bar-title">curata</span></div>
  <div class="content"><img class="shot" src="assets/shots/${b.id}.png" alt="" />${ringHtml}</div></div>`);
    a(`tl.to("#win-${b.id}", { opacity: 1, duration: ${XF}, ease: "none" }, ${(b.at - XF / 2).toFixed(2)});`);
    a(`tl.to("#win-${b.id}", { opacity: 0, duration: ${XF}, ease: "none" }, ${(b.end - XF / 2).toFixed(2)});`);
    const ringAt = b.at + Math.min(0.9, b.seconds * 0.3);
    if (ring) a(`tl.fromTo("#${b.id}-ring", { opacity: 0, scale: 1.04 }, { opacity: 1, scale: 1, duration: 0.4, ease: E }, ${ringAt.toFixed(2)});`);
  }
  if (b.card) {
    const c = b.card;
    body.push(`<div class="card h" id="${b.id}-card" data-layout-allow-overlap>${c.brand === false ? "" : `<div class="brand">${MARK(56)}<span>curata</span></div>`}<h1>${esc(c.title)}</h1>${c.subtitle ? `<p>${esc(c.subtitle)}</p>` : ""}${c.code ? `<div class="code mono">${esc(c.code)}</div>` : ""}${c.note ? `<p class="note">${esc(c.note)}</p>` : ""}</div>`);
    a(`tl.fromTo("#${b.id}-card", { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.5, ease: E }, ${(b.at + XF / 2).toFixed(2)});`);
    if (!b.last) a(`tl.to("#${b.id}-card", { opacity: 0, duration: ${XF}, ease: "none" }, ${(b.end - XF / 2).toFixed(2)});`);
  }
  if (b.caption) {
    body.push(`<div class="caption h" id="${b.id}-cap" data-layout-allow-overlap>${esc(b.caption)}</div>`);
    a(`tl.fromTo("#${b.id}-cap", { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.35, ease: E }, ${(b.at + 0.15).toFixed(2)});`);
    a(`tl.to("#${b.id}-cap", { opacity: 0, duration: 0.2, ease: "none" }, ${(b.end - 0.22).toFixed(2)});`);
  }
}
if (termBeats.length) a(`tl.to("#win-term", { opacity: 0, duration: ${XF}, ease: "none" }, ${(termCloseAt - XF / 2).toFixed(2)});`);

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${CW}, height=${CH}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>${CSS}</style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${DURATION}" data-width="${CW}" data-height="${CH}">
      <div id="scene" class="clip" data-start="0" data-duration="${DURATION}" data-track-index="0">
        <div id="stage">
${body.join("\n")}
        </div>
      </div>
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      const E = "power2.out";
      gsap.set(".h", { opacity: 0 });
${js.join("\n")}
      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
`;

const name = path.basename(projDir);
fs.mkdirSync(path.join(projDir, "assets", "shots"), { recursive: true });
fs.mkdirSync(path.join(projDir, "renders"), { recursive: true });
fs.mkdirSync(path.join(projDir, "assets", "fonts"), { recursive: true });
for (const [, , file] of FONT_FACES) fs.copyFileSync(path.join(FONTS_DIR, file), path.join(projDir, "assets", "fonts", file));
fs.writeFileSync(path.join(projDir, "index.html"), html);
fs.writeFileSync(path.join(projDir, "package.json"), JSON.stringify({ name, private: true, type: "module" }, null, 2) + "\n");
fs.writeFileSync(path.join(projDir, "meta.json"), JSON.stringify({ id: name, name }, null, 2) + "\n");
fs.writeFileSync(path.join(projDir, "hyperframes.json"), JSON.stringify({ paths: { assets: "assets" } }, null, 2) + "\n");
for (const b of beats) {
  if (b.story) fs.copyFileSync(path.join(capDir, `${b.id}.png`), path.join(projDir, "assets", "shots", `${b.id}.png`));
}
console.log(`${projDir}  duration ${DURATION}s`);
