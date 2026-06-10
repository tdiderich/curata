"use client";

import { useEffect, useState } from "react";
import type { GlanceCard as GlanceCardData } from "@/lib/glance-prompts";

export function GlanceCard({ card }: { card: GlanceCardData }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  const actionable = card.prompt.length > 0;

  const copy = async () => {
    if (!actionable) return;
    try {
      await navigator.clipboard.writeText(card.prompt);
      setCopied(true);
    } catch {
      // Clipboard unavailable (insecure context) — leave the card inert.
    }
  };

  return (
    <button
      type="button"
      className={`glance-card${actionable ? "" : " glance-card--empty"}${copied ? " glance-card--copied" : ""}`}
      onClick={copy}
      disabled={!actionable}
      title={actionable ? "Copy a ready-to-paste agent prompt with this context" : undefined}
    >
      <div className="glance-card-top">
        <span className="glance-card-title">{card.title}</span>
        <span className="glance-card-badge">{copied ? "Copied ✓" : card.subtitle}</span>
      </div>
      <p className="glance-card-summary">{card.summary}</p>
      {actionable && <span className="glance-card-hint">{copied ? "Paste into your agent session" : "Click to copy agent prompt"}</span>}
    </button>
  );
}
