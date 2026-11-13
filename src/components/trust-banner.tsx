"use client";

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { basePath } from "@/lib/api-fetch";

export interface TrustBannerProps {
  slug: string;
  /** Is the version being rendered right now the trusted one? */
  trusted: boolean;
  /** Does a trusted pointer exist that the latest version has moved past? */
  trustedBehind: boolean;
  /** True when this render is a ?latest=1 preview of the unapproved version. */
  previewingLatest: boolean;
  /** Anyone can preview/return; only page:edit AND approval-rule-eligible can approve. */
  canApprove: boolean;
  /** Set whenever an approval rule governs this page — shown in place of the button when ineligible. */
  approversNote?: string | null;
  /** Trust mode — "auto" pages never show the banner. */
  trustMode?: "auto" | "locked";
}

/// Read-path banner for the approval-gate flow. Purely derived from the
/// trusted/trustedBehind labels readPage/getPageSections already compute —
/// no extra state, no write-path involvement until "Approve latest" is
/// clicked.
export function TrustBanner({ slug, trusted, trustedBehind, previewingLatest, canApprove, approversNote, trustMode = "locked" }: TrustBannerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [approving, setApproving] = useState(false);

  function hrefWithLatest(on: boolean): string {
    const params = new URLSearchParams(searchParams.toString());
    if (on) params.set("latest", "1");
    else params.delete("latest");
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  async function approveLatest() {
    setApproving(true);
    try {
      const versionsRes = await fetch(`${basePath}/api/versions?slug=${encodeURIComponent(slug)}`);
      if (!versionsRes.ok) return;
      const data = (await versionsRes.json()) as { versions: Array<{ id: string }> };
      const latestId = data.versions[0]?.id;
      if (!latestId) return;
      const trustRes = await fetch(`${basePath}/api/versions/trust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, versionId: latestId }),
      });
      if (trustRes.ok) {
        router.push(hrefWithLatest(false));
        router.refresh();
      }
    } finally {
      setApproving(false);
    }
  }

  if (trustMode === "auto") return null;

  // Fully synced (trusted and nothing newer) — nothing to say.
  if (trusted && !trustedBehind) return null;

  // Never trusted at all: a subtle indicator, no actions — matches the queue,
  // where "trust latest" lives as the one-click action.
  if (!trustedBehind) {
    return (
      <div className="trust-banner trust-banner--none" role="status">
        <span className="trust-banner-dot" aria-hidden="true" />
        <span>Not yet trusted. No version of this page has been approved.</span>
      </div>
    );
  }

  if (previewingLatest) {
    return (
      <div className="trust-banner trust-banner--preview" role="status">
        <span>
          Previewing the newest version. It hasn&apos;t been approved yet.
        </span>
        <span className="trust-banner-actions">
          <a href={hrefWithLatest(false)} className="trust-banner-link">Back to approved version</a>
          {canApprove ? (
            <button className="trust-banner-approve" disabled={approving} onClick={approveLatest}>
              {approving ? "Approving…" : "Approve latest"}
            </button>
          ) : (
            approversNote && <span className="trust-banner-note">{approversNote}</span>
          )}
        </span>
      </div>
    );
  }

  return (
    <div className="trust-banner trust-banner--stale" role="status">
      <span>
        You&apos;re viewing the approved version. A newer version awaits approval.
      </span>
      <span className="trust-banner-actions">
        <a href={hrefWithLatest(true)} className="trust-banner-link">View newer version</a>
        {canApprove ? (
          <button className="trust-banner-approve" disabled={approving} onClick={approveLatest}>
            {approving ? "Approving…" : "Approve latest"}
          </button>
        ) : (
          approversNote && <span className="trust-banner-note">{approversNote}</span>
        )}
      </span>
    </div>
  );
}

export type TrustChipData =
  | { kind: "trusted"; at: string | null; by: string | null }
  | { kind: "auto" };

const CHIP_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/// Quiet header chip for the states TrustBanner stays silent on: a fully
/// trusted page (who approved it, and when) or an auto-published one, which
/// carries a caution tone and says "not reviewed" in visible text. Lives
/// in the page hero, so presentation mode and exports never render it.
export function TrustChip({ chip }: { chip: TrustChipData }) {
  if (chip.kind === "auto") {
    return (
      <span className="trust-chip trust-chip--auto">
        <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
        </svg>
        <span>Auto-published</span>
        <span className="trust-chip-detail">· not reviewed</span>
      </span>
    );
  }
  const date = chip.at ? CHIP_DATE.format(new Date(chip.at)) : null;
  const detail = [date && `approved ${date}`, chip.by && `by ${chip.by}`].filter(Boolean).join(" ");
  return (
    <span className="trust-chip trust-chip--trusted" title="A human approved this version. Agents read it on the trusted channel.">
      <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 6 9 17l-5-5" />
      </svg>
      <span>Trusted</span>
      {detail && <span className="trust-chip-detail">· {detail}</span>}
    </span>
  );
}
