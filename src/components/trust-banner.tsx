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
}

/// Read-path banner for the approval-gate flow. Purely derived from the
/// trusted/trustedBehind labels readPage/getPageSections already compute —
/// no extra state, no write-path involvement until "Approve latest" is
/// clicked.
export function TrustBanner({ slug, trusted, trustedBehind, previewingLatest, canApprove, approversNote }: TrustBannerProps) {
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

  // Fully synced (trusted and nothing newer) — nothing to say.
  if (trusted && !trustedBehind) return null;

  // Never trusted at all: a subtle indicator, no actions — matches the queue,
  // where "trust latest" lives as the one-click action.
  if (!trustedBehind) {
    return (
      <div className="trust-banner trust-banner--none" role="status">
        <span className="trust-banner-dot" aria-hidden="true" />
        <span>Not yet trusted — no version of this page has been approved.</span>
      </div>
    );
  }

  if (previewingLatest) {
    return (
      <div className="trust-banner trust-banner--preview" role="status">
        <span>
          Previewing the newest version — it hasn&apos;t been approved yet.
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
