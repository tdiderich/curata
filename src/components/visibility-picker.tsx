"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { basePath } from "@/lib/api-fetch";
import { toast } from "./toast";

const LEVELS = [
  { value: "private", label: "Private", desc: "Only you" },
  { value: "org", label: "Org", desc: "All members" },
  { value: "public", label: "Public", desc: "Anyone with the link" },
] as const;

interface VisibilityPickerProps {
  slug: string;
  orgSlug: string;
  visibility: string;
  authMode?: string;
}

export function VisibilityPicker({ slug, orgSlug, visibility, authMode }: VisibilityPickerProps) {
  const router = useRouter();
  const [current, setCurrent] = useState(visibility);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const available = authMode === "none"
    ? LEVELS.filter((l) => l.value !== "private")
    : LEVELS;

  async function setVisibility(value: string) {
    if (value === current) { setOpen(false); return; }
    setBusy(true);
    setOpen(false);
    try {
      const res = await fetch(`${basePath}/api/pages`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, visibility: value }),
      });
      if (res.ok) {
        setCurrent(value);
        if (value === "public") {
          const url = `${window.location.origin}${basePath.replace(/\/$/, "")}/p/${orgSlug}/${slug}`;
          await navigator.clipboard.writeText(url);
          toast.success("Public link copied");
        }
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(`Couldn't update visibility: ${data.error ?? "unknown error"}`);
      }
    } catch {
      toast.error("Couldn't update visibility — check your connection and try again.");
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  async function copyPublicLink() {
    const url = `${window.location.origin}${basePath.replace(/\/$/, "")}/p/${orgSlug}/${slug}`;
    await navigator.clipboard.writeText(url);
    toast.success("Public link copied");
  }

  const currentLevel = LEVELS.find((l) => l.value === current) ?? LEVELS[1];

  return (
    <div className="vis-picker" ref={ref}>
      <button
        className={`vis-picker-trigger vis-picker-trigger--${current}`}
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        title={`Visibility: ${currentLevel.label} — ${currentLevel.desc}`}
      >
        <VisIcon level={current} />
        <span className="vis-picker-label">{currentLevel.label}</span>
        <span className="vis-picker-chevron" aria-hidden>&#9662;</span>
      </button>
      {open && (
        <div className="vis-picker-menu">
          {available.map((l) => (
            <button
              key={l.value}
              className={`vis-picker-option${l.value === current ? " vis-picker-option--active" : ""}`}
              onClick={() => setVisibility(l.value)}
            >
              <VisIcon level={l.value} />
              <span className="vis-picker-option-text">
                <span className="vis-picker-option-label">{l.label}</span>
                <span className="vis-picker-option-desc">{l.desc}</span>
              </span>
              {l.value === current && <span className="vis-picker-check">&#10003;</span>}
            </button>
          ))}
          {current === "public" && (
            <>
              <div className="vis-picker-divider" />
              <button className="vis-picker-option" onClick={copyPublicLink}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
                <span className="vis-picker-option-text">
                  <span className="vis-picker-option-label">Copy public link</span>
                </span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function VisIcon({ level }: { level: string }) {
  if (level === "private") {
    return (
      <svg className="vis-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    );
  }
  if (level === "org") {
    return (
      <svg className="vis-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    );
  }
  return (
    <svg className="vis-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}
