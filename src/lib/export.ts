import { readFileSync } from "fs";
import { join } from "path";

const KAZAM_CSS = readFileSync(
  join(process.cwd(), "src/app/kazam.css"),
  "utf8"
);

type Theme = { theme: string; mode: string; texture: string; glow: string };

function themeAttrs(theme: Theme): string {
  return `data-theme="${theme.theme}" data-mode="${theme.mode}" data-texture="${theme.texture}" data-glow="${theme.glow}"`;
}

function esc(s: string): string {
  return s.replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

export function buildTitlePageHtml(
  title: string,
  subtitle: string | undefined,
  date: string,
  pageCount: number,
  pageTitles: string[],
  theme: Theme
): string {
  const tocItems = pageTitles.map((t, i) =>
    `<div style="display:flex;align-items:baseline;gap:12px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
      <span style="font-size:13px;color:rgba(255,255,255,0.3);font-variant-numeric:tabular-nums;min-width:20px;">${i + 1}</span>
      <span style="font-size:15px;color:rgba(255,255,255,0.8);">${esc(t)}</span>
    </div>`
  ).join('');

  return `<!DOCTYPE html>
<html ${themeAttrs(theme)}>
<head><meta charset="utf-8"><style>${KAZAM_CSS}</style></head>
<body class="shell-standard" style="margin:0;min-height:100vh;">
  <div style="max-width:1000px;margin:0 auto;padding:120px 56px 80px;min-height:100vh;box-sizing:border-box;display:flex;flex-direction:column;">
    <div style="flex:1;">
      <div style="font-size:13px;text-transform:uppercase;letter-spacing:2px;color:var(--teal);margin-bottom:16px;">Report</div>
      <h1 style="font-size:40px;font-weight:700;color:var(--snow);margin:0 0 12px;line-height:1.2;">${esc(title)}</h1>
      ${subtitle ? `<p style="font-size:18px;color:rgba(255,255,255,0.6);margin:0 0 48px;line-height:1.5;">${esc(subtitle)}</p>` : '<div style="height:48px;"></div>'}
      <div style="width:60px;height:2px;background:var(--teal);margin-bottom:48px;"></div>
      <div style="margin-bottom:16px;">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:rgba(255,255,255,0.4);margin-bottom:16px;">Contents</div>
        ${tocItems}
      </div>
    </div>
    <div style="display:flex;gap:24px;font-size:13px;color:rgba(255,255,255,0.4);padding-top:32px;border-top:1px solid rgba(255,255,255,0.06);">
      <span>${esc(date)}</span>
      <span>${pageCount} page${pageCount !== 1 ? 's' : ''}</span>
    </div>
  </div>
</body>
</html>`;
}

export function buildAppendixHtml(
  pageTitles: string[],
  slugs: string[],
  theme: Theme
): string {
  const rows = pageTitles.map((t, i) =>
    `<tr style="border-bottom:1px solid rgba(255,255,255,0.06);">
      <td style="padding:12px 16px 12px 0;font-size:13px;color:rgba(255,255,255,0.3);font-variant-numeric:tabular-nums;">${i + 1}</td>
      <td style="padding:12px 0;font-size:15px;color:var(--snow);font-weight:500;">${esc(t)}</td>
      <td style="padding:12px 0 12px 16px;font-size:13px;color:rgba(255,255,255,0.4);text-align:right;">${esc(slugs[i])}</td>
    </tr>`
  ).join('');

  return `<!DOCTYPE html>
<html ${themeAttrs(theme)}>
<head><meta charset="utf-8"><style>${KAZAM_CSS}</style></head>
<body class="shell-standard" style="margin:0;">
  <div style="max-width:1000px;margin:0 auto;padding:80px 56px;">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:rgba(255,255,255,0.4);margin-bottom:24px;">Appendix</div>
    <h2 style="font-size:24px;font-weight:600;color:var(--snow);margin:0 0 32px;">Pages included in this report</h2>
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="border-bottom:2px solid rgba(255,255,255,0.1);">
          <th style="text-align:left;padding:8px 16px 8px 0;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:rgba(255,255,255,0.4);font-weight:500;">#</th>
          <th style="text-align:left;padding:8px 0;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:rgba(255,255,255,0.4);font-weight:500;">Page</th>
          <th style="text-align:right;padding:8px 0 8px 16px;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:rgba(255,255,255,0.4);font-weight:500;">Slug</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</body>
</html>`;
}
