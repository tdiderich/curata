"use client";

import { useRouter } from "next/navigation";

export function DeletePageButton({
  slug,
  title,
}: {
  slug: string;
  title: string;
}) {
  const router = useRouter();

  async function handleDelete() {
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;

    const res = await fetch("/api/pages", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug }),
    });

    if (res.ok) {
      router.refresh();
    }
  }

  return (
    <button className="members-remove-btn" onClick={handleDelete}>
      Delete
    </button>
  );
}
