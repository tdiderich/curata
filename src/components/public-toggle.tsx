"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PublicToggle({
  slug,
  orgSlug,
  isPublic,
}: {
  slug: string;
  orgSlug: string;
  isPublic: boolean;
}) {
  const router = useRouter();
  const [on, setOn] = useState(isPublic);
  const [busy, setBusy] = useState(false);

  const publicUrl = typeof window !== "undefined"
    ? `${window.location.origin}/p/${orgSlug}/${slug}`
    : "";

  async function toggle() {
    const next = on ? "shared" : "public";
    setBusy(true);
    try {
      const res = await fetch("/api/pages", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, visibility: next }),
      });
      if (res.ok) {
        setOn(!on);
      }
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <div className="public-toggle-wrap">
      <button
        className={`public-toggle${on ? " public-toggle--on" : ""}`}
        onClick={toggle}
        disabled={busy}
        title={on ? "Page is public — click to make private" : "Make page public"}
      >
        <span className="public-toggle-track">
          <span className="public-toggle-thumb" />
        </span>
        <span className="public-toggle-label">{on ? "Public" : "Private"}</span>
      </button>
      {on && (
        <button
          className="public-toggle-copy"
          onClick={() => {
            navigator.clipboard.writeText(publicUrl);
          }}
        >
          Copy link
        </button>
      )}
    </div>
  );
}
