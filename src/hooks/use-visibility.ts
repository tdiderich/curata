"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { basePath } from "@/lib/api-fetch";
import { toast } from "@/components/toast";

const VISIBILITY_OPTIONS = [
  { value: "private", label: "Private", desc: "Only you" },
  { value: "org", label: "Org", desc: "All members" },
  { value: "public", label: "Public", desc: "Anyone with the link" },
] as const;

export type VisibilityLevel = (typeof VISIBILITY_OPTIONS)[number]["value"];

export function useVisibility(slug: string, initial: string, authMode?: string) {
  const router = useRouter();
  const [current, setCurrent] = useState(initial);
  const [busy, setBusy] = useState(false);

  const available = authMode === "none"
    ? VISIBILITY_OPTIONS.filter((l) => l.value !== "private")
    : [...VISIBILITY_OPTIONS];

  async function setVisibility(value: string) {
    if (value === current) return;
    setBusy(true);
    try {
      const res = await fetch(`${basePath}/api/pages`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, visibility: value }),
      });
      if (res.ok) {
        setCurrent(value);
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(`Couldn't update visibility: ${data.error ?? "unknown error"}`);
      }
    } catch {
      toast.error("Couldn't update visibility - check your connection and try again.");
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  return { current, busy, available, setVisibility };
}
