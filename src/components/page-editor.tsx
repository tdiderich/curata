"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageEditor as KazamPageEditor, type PageData } from "@/generated/kazam-renderer";
import { toast } from "@/components/toast";
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
  const [baseline, setBaseline] = useState(() => JSON.stringify(initial));
  const dirty = useMemo(() => JSON.stringify(page) !== baseline, [page, baseline]);

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
          setBaseline(JSON.stringify(page));
          toast.success("Page saved");
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
        {error && <span className="pe-error" role="alert">{error}</span>}
        {dirty && !saving && (
          <button
            className="pe-discard-btn"
            onClick={() => {
              if (confirm("Discard unsaved changes?")) setPage(JSON.parse(baseline) as PageData);
            }}
          >
            Discard
          </button>
        )}
        <button
          className="pe-save-btn"
          onClick={() => {
            if (dirty) save();
            else router.push(`/pages/${slug}`);
          }}
          disabled={saving || !page.title?.trim()}
        >
          {saving ? "Saving…" : dirty ? "Save" : "Done"}
        </button>
      </div>
    </div>
  );
}
