import Link from "next/link";
import { StatusBadge, type StatusBadgeTone } from "@/components/settings/status-badge";
import type { DependentPage, ExternalDependentRow } from "@/lib/concepts";

/**
 * Cells shared by every dependency surface: the settings tab, /map/<term>
 * (table and board), the page pill and the dashboard card. Pure markup, no
 * fetch, so they render identically in Storybook and the app.
 */

const REL_TONE: Record<string, StatusBadgeTone> = {
  depends: "depends",
  asserts: "asserts",
  references: "references",
  instantiates: "instantiates",
};

export function relBadge(rel: string) {
  return <StatusBadge tone={REL_TONE[rel] ?? "references"} label={rel} />;
}

export function relativeTime(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 60) return `${d}d ago`;
  return `${Math.round(d / 30)}mo ago`;
}

export type VerifyState = "never" | "needs-change" | "stale" | "ok";

export function verifyState(p: Pick<DependentPage, "verifiedAt" | "staleAgainstSource" | "needsChange">): VerifyState {
  if (p.needsChange && p.verifiedAt) return "needs-change";
  if (!p.verifiedAt) return "never";
  if (p.staleAgainstSource) return "stale";
  return "ok";
}

export const VERIFY_STATE_LABEL: Record<VerifyState, { page: string; external: string; tone: StatusBadgeTone }> = {
  never: { page: "never verified", external: "never checked", tone: "untrusted" },
  "needs-change": { page: "needs update", external: "needs update", tone: "needs-change" },
  stale: { page: "source changed", external: "source changed", tone: "behind" },
  ok: { page: "verified", external: "verified", tone: "trusted" },
};

export function noteCell(note: string | null) {
  if (!note) return <span className="stg-dep-note stg-dep-note--empty">–</span>;
  return <span className="stg-dep-note" title={note}>{note}</span>;
}

export function verifiedCell(p: Pick<DependentPage, "verifiedAt" | "staleAgainstSource" | "needsChange">, kind: "page" | "external" = "page") {
  const state = verifyState(p);
  const meta = VERIFY_STATE_LABEL[state];
  const label = kind === "external" ? meta.external : meta.page;
  if (state === "never") return <StatusBadge tone={meta.tone} label={label} />;
  return (
    <span className="stg-dep-verified">
      <StatusBadge tone={meta.tone} label={label} />
      <span className="stg-dep-when">{relativeTime(p.verifiedAt as string)}</span>
    </span>
  );
}

export function faviconUrl(host: string) {
  return `https://www.google.com/s2/favicons?sz=32&domain=${encodeURIComponent(host)}`;
}

export function externalLink(e: ExternalDependentRow) {
  return (
    <a href={e.url} target="_blank" rel="noopener noreferrer" className="stg-dep-link stg-dep-ext" title={`Opens ${e.host} in a new tab`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={faviconUrl(e.host)} alt="" width={13} height={13} className="stg-dep-favicon" />
      {e.label}
      <span aria-hidden className="stg-dep-arrow">↗</span>
    </a>
  );
}

export function pageLink(d: Pick<DependentPage, "slug" | "title">) {
  return (
    <Link href={`/pages/${d.slug}`} className="stg-dep-link">
      {d.title || d.slug}
    </Link>
  );
}

export function termLink(term: string) {
  return (
    <Link href={`/map/${term}`} className="stg-dep-term">
      {term}
    </Link>
  );
}
