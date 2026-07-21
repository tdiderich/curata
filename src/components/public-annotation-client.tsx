"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PageContent } from "./page-viewer";
import { basePath } from "@/lib/api-fetch";
import { useHighlights } from "@/hooks/use-highlights";
import { DeckControlContext } from "@/generated/kazam-renderer";

interface Annotation {
  id: string;
  text: string;
  author: string;
  section?: string;
  target?: string;
  kind?: string;
  added: string;
  status: string;
  slide?: string;
}

interface FormState {
  section: string;
  target: string;
  y: number;
}

function daysAgo(dateStr: string): number {
  const d = new Date(dateStr);
  const now = new Date();
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

export default function PublicAnnotationClient({
  orgSlug,
  pageSlug,
  children,
  annotations,
  isSignedIn,
  printFlow,
  shell,
}: {
  orgSlug: string;
  pageSlug: string;
  children?: React.ReactNode;
  annotations: Annotation[];
  isSignedIn: boolean;
  printFlow?: string;
  shell?: string;
}) {
  const router = useRouter();
  const contentRef = useRef<HTMLDivElement>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [formState, setFormState] = useState<FormState | null>(null);
  const [formText, setFormText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isDeck = shell === "deck";
  const [slideIndex, setSlideIndex] = useState(() => {
    if (typeof window === "undefined" || !isDeck) return 0;
    const p = new URLSearchParams(window.location.search);
    const s = parseInt(p.get("slide") ?? "", 10);
    return isNaN(s) || s < 1 ? 0 : s - 1;
  });

  const [currentSlideLabel, setCurrentSlideLabel] = useState<string | null>(null);
  useEffect(() => {
    if (!isDeck) return;
    const label = contentRef.current?.querySelector(".deck-nav-label")?.textContent ?? null;
    setCurrentSlideLabel(label);
  }, [isDeck, slideIndex]);

  const activeAnns = useMemo(
    () => annotations.filter((a) =>
      a.kind !== "talking_point" &&
      (a.status !== "incorporated" && a.status !== "ignored") &&
      (!isDeck || !currentSlideLabel || !a.slide || a.slide === currentSlideLabel),
    ),
    [annotations, isDeck, currentSlideLabel],
  );

  useEffect(() => {
    if (!printFlow) return;
    const cls = `print-${printFlow}`;
    document.body.classList.add(cls);
    return () => { document.body.classList.remove(cls); };
  }, [printFlow]);

  const highlightTargets = useMemo(
    () => activeAnns.map((a) => ({ id: a.id, text: a.target ?? "", section: a.section })),
    [activeAnns],
  );

  const { positions: hlPositions, ranges: hlRanges } = useHighlights(
    contentRef,
    highlightTargets,
    { isDeck },
  );

  const hlRangesRef = useRef(hlRanges);
  useEffect(() => { hlRangesRef.current = hlRanges; }, [hlRanges]);

  useEffect(() => {
    let hoverTimer: ReturnType<typeof setTimeout> | null = null;
    let hoveredAnn: string | null = null;

    function hitTest(x: number, y: number): string | null {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      const overlay = el?.closest(".ann-highlight-overlay[data-ann]") as HTMLElement | null;
      if (overlay?.dataset.ann) return overlay.dataset.ann;
      for (const [id, range] of hlRangesRef.current) {
        for (const rect of range.getClientRects()) {
          if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return id;
        }
      }
      return null;
    }

    function handleClick(e: MouseEvent) {
      const el = e.target as HTMLElement;
      if (el.closest(".ann-card") || el.closest(".ann-bubble")) return;
      const annId = hitTest(e.clientX, e.clientY);
      if (annId) { setExpandedId(annId); return; }
      setExpandedId(null);
    }

    function handleMove(e: MouseEvent) {
      const annId = hitTest(e.clientX, e.clientY);
      if (annId === hoveredAnn) return;
      if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
      hoveredAnn = annId;
      if (annId) {
        hoverTimer = setTimeout(() => setExpandedId(annId), 400);
      }
    }

    const root = contentRef.current;
    document.addEventListener("mousedown", handleClick);
    root?.addEventListener("mousemove", handleMove);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      root?.removeEventListener("mousemove", handleMove);
      if (hoverTimer) clearTimeout(hoverTimer);
    };
  }, []);

  const openForm = useCallback(
    (_section: string, target: string) => {
      if (!isSignedIn) return;
      const root = contentRef.current;
      if (!root) return;
      const sel = window.getSelection();
      let y = 100;
      if (sel && !sel.isCollapsed) {
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const rootRect = root.getBoundingClientRect();
        y = rect.top - rootRect.top;
      }
      setFormState({ section: _section, target, y });
      setFormText("");
      setExpandedId(null);
      window.getSelection()?.removeAllRanges();
    },
    [isSignedIn],
  );

  async function submitForm() {
    if (!formState || !formText.trim()) return;
    setSubmitting(true);

    await fetch(`${basePath}/api/public-annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orgSlug,
        pageSlug,
        text: formText.trim(),
        section: formState.section || undefined,
        target: formState.target || undefined,
        slide: isDeck ? currentSlideLabel || undefined : undefined,
      }),
    });

    setFormState(null);
    setFormText("");
    setSubmitting(false);
    router.refresh();
  }

  return (
    <div className="page-detail-layout public-annotation-layout">
      <div className="page-content-wrap">
        <PageContent
          ref={contentRef}
          selectionActions={isSignedIn ? [
            { label: "Annotate", onSelect: (section, target) => openForm(section, target) },
          ] : undefined}
        >
          {isDeck ? (
            <DeckControlContext.Provider value={{ slide: slideIndex, onSlideChange: setSlideIndex }}>
              {children}
            </DeckControlContext.Provider>
          ) : children}
        </PageContent>

        <div className="ann-margin" aria-label="Annotations">
          {isSignedIn && (
            <div className="ann-marker" style={{ top: 0 }}>
              <button
                className="ann-bubble ann-bubble--add"
                onClick={() => {
                  setFormState({ section: "", target: "", y: 0 });
                  setFormText("");
                  setExpandedId(null);
                }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="7" y1="2" x2="7" y2="12" />
                  <line x1="2" y1="7" x2="12" y2="7" />
                </svg>
                <span className="ann-bubble-tooltip">Add annotation</span>
              </button>
            </div>
          )}

          {!isSignedIn && activeAnns.length === 0 && (
            <div className="ann-marker" style={{ top: 0 }}>
              <Link href="/sign-up" className="ann-bubble ann-bubble--add" title="Sign up to annotate">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="7" y1="2" x2="7" y2="12" />
                  <line x1="2" y1="7" x2="12" y2="7" />
                </svg>
                <span className="ann-bubble-tooltip">Sign up to annotate</span>
              </Link>
            </div>
          )}

          {activeAnns.map((ann) => {
            const y = hlPositions.get(ann.id);
            if (y === undefined) return null;
            const isExpanded = expandedId === ann.id;
            const showCard = isExpanded || hoveredId === ann.id;

            return (
              <div
                key={ann.id}
                className="ann-marker"
                style={{ top: y }}
                onMouseEnter={() => { if (hoverTimeout.current) clearTimeout(hoverTimeout.current); setHoveredId(ann.id); }}
                onMouseLeave={() => { hoverTimeout.current = setTimeout(() => setHoveredId(null), 300); }}
              >
                <button
                  className="ann-bubble"
                  onClick={() => setExpandedId(isExpanded ? null : ann.id)}
                >
                  {ann.author.charAt(0).toUpperCase()}
                </button>

                {showCard && (
                  <div className="ann-card">
                    <div className="ann-card-header">
                      <span className="ann-card-author">{ann.author}</span>
                      <span className="ann-card-age">{daysAgo(ann.added)}d</span>
                      <button
                        className="ann-card-close"
                        onClick={() => { setExpandedId(null); setHoveredId(null); }}
                      >
                        &times;
                      </button>
                    </div>
                    <div className="ann-card-text">{ann.text}</div>
                  </div>
                )}
              </div>
            );
          })}

          {formState && (
            <div className="ann-marker ann-form-marker" style={{ top: formState.y }}>
              <div className="ann-form-card">
                {formState.target && (
                  <div className="ann-form-target">
                    <span className="ann-form-target-label">Re:</span>
                    <span className="ann-form-target-text">
                      {formState.target.length > 80
                        ? formState.target.slice(0, 80) + "…"
                        : formState.target}
                    </span>
                  </div>
                )}
                <textarea
                  className="ann-form-input"
                  autoFocus
                  placeholder="Add your note…"
                  value={formText}
                  onChange={(e) => setFormText(e.target.value)}
                  rows={3}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setFormState(null);
                    if (e.key === "Enter" && e.metaKey) submitForm();
                  }}
                />
                <div className="ann-form-footer">
                  <span className="ann-form-mode">note</span>
                  <div className="ann-form-btns">
                    <button className="ann-form-cancel" onClick={() => setFormState(null)}>
                      Cancel
                    </button>
                    <button
                      className="ann-form-submit"
                      disabled={submitting || !formText.trim()}
                      onClick={submitForm}
                    >
                      {submitting ? "…" : "Add"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
