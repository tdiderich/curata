"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageEditor as KazamPageEditor, type PageData } from "@/generated/kazam-renderer";
import { basePath } from "@/lib/api-fetch";

export default function PageEditorWrapper({
  slug,
  initial,
  contentHash: initialHash,
}: {
  slug: string;
  initial: PageData;
  contentHash: string;
}) {
  const router = useRouter();
  const [page, setPage] = useState<PageData>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [currentHash, setCurrentHash] = useState(initialHash);

  async function save() {
    setSaving(true);
    setError("");

    const clean = {
      ...page,
      components: (page.components || []).map((c) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(c)) {
          if (v !== undefined && v !== "") out[k] = v;
        }
        return out;
      }),
    };

    try {
      let hash = currentHash;
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await fetch(`${basePath}/api/pages/content`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slug,
            json: clean,
            expectedHash: hash,
          }),
        });

        if (res.ok) {
          setSaving(false);
          router.push(`/pages/${slug}`);
          return;
        }

        if (res.status === 409 && attempt === 0) {
          const latest = await fetch(`${basePath}/api/pages/content?slug=${encodeURIComponent(slug)}`);
          if (latest.ok) {
            const data = await latest.json();
            hash = data.contentHash;
            setCurrentHash(hash);
            continue;
          }
        }

        const data = await res.json();
        setError(data.error || "Save failed");
        setSaving(false);
        return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setSaving(false);
    }
  }

  return (
    <div>
      <KazamPageEditor page={page} onChange={setPage} />
      <div className="pe-footer">
        <button
          className="pe-save-btn"
          onClick={save}
          disabled={saving || !page.title?.trim()}
        >
          {saving ? "Saving..." : "Save"}
        </button>
        {error && <span className="pe-error">{error}</span>}
      </div>
    </div>
  );
}
