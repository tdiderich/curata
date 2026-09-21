"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { basePath } from "@/lib/api-fetch";
import type { ChartChild } from "@/lib/chart";
import { toast } from "@/components/toast";

/**
 * "Checked": one click sets lastCheckedAt on this edge. Same call as the
 * mark_verified tool, so a human clicking and an agent calling leave the
 * same state. A check is per edge, so the toast names the other nodes the
 * same page or asset still needs a look under.
 */
export function ChartCheckButton({ child, term }: { child: ChartChild; term: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      toast.success(child.alsoUnder.length > 0
        ? `Checked ${child.label} here. Still needs a look under ${child.alsoUnder.join(", ")}.`
        : `Checked ${child.label}.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
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

export function ChartNodeToggle({ term, field, value, onLabel, offLabel }: { term: string; field: "hidden" | "promoted"; value: boolean; onLabel: string; offLabel: string }) {
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
