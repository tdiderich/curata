"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { basePath } from "@/lib/api-fetch";
import type { ChartChild } from "@/lib/chart";

/**
 * "Checked": one click sets lastCheckedAt on this edge. Same call as the
 * mark_verified tool, so a human clicking and an agent calling leave the
 * same state. If the same page or asset sits under other nodes, the row
 * offers to check it there too, because a check is per edge.
 */
export function ChartCheckButton({ child, term }: { child: ChartChild; term: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offerAlso, setOfferAlso] = useState(false);

  async function check(terms: string[]) {
    setBusy(true);
    setError(null);
    try {
      for (const t of terms) {
        const res = await fetch(`${basePath}/api/dependents/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug: child.slug ?? undefined, url: child.url ?? undefined, term: t, status: "holds" }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
      }
      if (terms.length === 1 && child.alsoUnder.length > 0) setOfferAlso(true);
      else setOfferAlso(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (offerAlso) {
    return (
      <span className="chart-also">
        <span>Also under {child.alsoUnder.join(", ")}, still yellow there.</span>
        <button type="button" className="stg-qbtn" disabled={busy} onClick={() => void check(child.alsoUnder)}>Check there too</button>
        <button type="button" className="stg-qbtn stg-qbtn--ghost" onClick={() => setOfferAlso(false)}>Leave it</button>
      </span>
    );
  }
  return (
    <span className="chart-check">
      <button type="button" className="stg-qbtn" disabled={busy} onClick={() => void check([term])} title="Looked at it, it's right for this node">
        {busy ? "Saving" : "Checked"}
      </button>
      {error && <span className="stg-dep-verify-error">{error}</span>}
    </span>
  );
}

export function ChartNodeToggle({ term, field, value, onLabel, offLabel }: { term: string; field: "pinned" | "hidden" | "promoted"; value: boolean; onLabel: string; offLabel: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function flip() {
    setBusy(true);
    try {
      await fetch(`${basePath}/api/chart`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ term, [field]: !value }) });
      router.refresh();
    } finally { setBusy(false); }
  }
  return <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => void flip()}>{value ? onLabel : offLabel}</button>;
}
