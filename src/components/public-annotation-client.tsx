"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PageContent } from "./page-viewer";
import { basePath } from "@/lib/api-fetch";
import { highlightTarget, clearHighlights } from "@/lib/annotation-highlights";

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
  mode: "note" | "talking_point";
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
  const [contentNode, setContentNode] = useState<HTMLDivElement | null>(null);
  const mergedContentRef = useCallback((node: HTMLDivElement | null) => {
    contentRef.current = node;
    setContentNode(node);
  }, []);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [annPositions, setAnnPositions] = useState(new Map<string, number>());
  const [formState, setFormState] = useState<FormState | null>(null);
  const [formText, setFormText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showTalkingPoints, setShowTalkingPoints] = useState(true);

  const [currentSlide, setCurrentSlide] = useState<string | null>(null);

  useEffect(() => {
    if (shell !== "deck") return;
    const handler = (e: Event) => {
      const label = (e as CustomEvent).detail?.label ?? null;
      setCurrentSlide(label);
    };
    document.addEventListener("deckslidechange", handler);
    const navLabel = document.querySelector(".deck-nav-label");
    if (navLabel?.textContent) {
      const text = navLabel.textContent;
      queueMicrotask(() => setCurrentSlide(text));
    }
    return () => document.removeEventListener("deckslidechange", handler);
  }, [shell]);

  const activeAnns = useMemo(
    () => annotations.filter((a) =>
      a.kind !== "talking_point" &&
      (a.status !== "incorporated" && a.status !== "ignored") &&
      (shell !== "deck" || !currentSlide || !a.slide || a.slide === currentSlide),
    ),
    [annotations, shell, currentSlide],
  );

  const talkingPoints = useMemo(
    () => annotations.filter((a) =>
      a.kind === "talking_point" &&
      a.status !== "incorporated" && a.status !== "ignored" &&
      (shell !== "deck" || !currentSlide || !a.slide || a.slide === currentSlide),
    ),
    [annotations, shell, currentSlide],
  );

  useEffect(() => {
    if (!printFlow) return;
    const cls = `print-${printFlow}`;
    document.body.classList.add(cls);
    return () => { document.body.classList.remove(cls); };
  }, [printFlow]);

  const [tpPositions, setTpPositions] = useState(new Map<string, { x: number; y: number; width: number }>());

  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;

    clearHighlights(root);
    const positions = new Map<string, number>();
    const tpPos = new Map<string, { x: number; y: number; width: number }>();

    const allHighlightable = [...activeAnns, ...talkingPoints];

    for (const ann of allHighlightable) {
      let y: number | null = null;

      if (ann.target) {
        const mark = highlightTarget(root, ann.target, ann.id);
        if (mark) {
          const rootRect = root.getBoundingClientRect();
          const markRect = mark.getBoundingClientRect();
          y = markRect.top - rootRect.top;

          if (ann.kind === "talking_point") {
            tpPos.set(ann.id, {
              x: markRect.left - rootRect.left,
              y: markRect.bottom - rootRect.top + 4,
              width: markRect.width,
            });
          }
        }
      }

      if (ann.kind !== "talking_point") {
        positions.set(ann.id, y ?? 40);
      }
    }

    const sorted = [...positions.entries()].sort((a, b) => a[1] - b[1]);
    const MIN_GAP = 36;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i][1] - sorted[i - 1][1] < MIN_GAP) {
        sorted[i][1] = sorted[i - 1][1] + MIN_GAP;
        positions.set(sorted[i][0], sorted[i][1]);
      }
    }

    setAnnPositions(positions);
    setTpPositions(tpPos);
  }, [activeAnns, talkingPoints]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "t" || e.key === "T") {
        setShowTalkingPoints((v) => !v);
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);

  useEffect(() => {
    let hoverTimer: ReturnType<typeof setTimeout> | null = null;
    let hoveredAnn: string | null = null;

    function handleClick(e: MouseEvent) {
      const el = e.target as HTMLElement;
      if (el.closest(".ann-card") || el.closest(".ann-bubble")) return;
      const highlight = el.closest("[data-ann]") as HTMLElement | null;
      if (highlight?.dataset.ann) {
        setExpandedId(highlight.dataset.ann);
        return;
      }
      setExpandedId(null);
    }

    function handleMove(e: MouseEvent) {
      const el = e.target as HTMLElement;
      const highlight = el.closest("[data-ann]") as HTMLElement | null;
      const annId = highlight?.dataset.ann ?? null;
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
    (_section: string, target: string, mode: "note" | "talking_point" = "note") => {
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
      setFormState({ section: _section, target, y, mode });
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
        slide: shell === "deck" ? currentSlide || undefined : undefined,
        kind: formState.mode === "talking_point" ? "talking_point" : undefined,
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
          ref={mergedContentRef}
          selectionActions={isSignedIn ? [
            { label: "Annotate", onSelect: (section, target) => openForm(section, target) },
            { label: "Talking Point", onSelect: (section, target) => openForm(section, target, "talking_point") },
          ] : undefined}
        >
          {children}
        </PageContent>

        {showTalkingPoints && contentNode && (() => {
          const container = contentNode;
          return talkingPoints.map((tp) => {
            const pos = tpPositions.get(tp.id);
            if (!pos) return null;
            return createPortal(
              <div
                key={tp.id}
                className="tp-bubble"
                style={{
                  position: "absolute",
                  left: pos.x,
                  top: pos.y,
                  maxWidth: Math.max(pos.width, 200),
                }}
              >
                <div className="tp-bubble-tail" />
                <div className="tp-bubble-content">
                  <span className="tp-bubble-text">{tp.text}</span>
                  <span className="tp-bubble-author">{tp.author}</span>
                </div>
              </div>,
              container,
              tp.id,
            );
          });
        })()}

        <div className="ann-margin" aria-label="Annotations">
          {isSignedIn && (
            <div className="ann-marker" style={{ top: 0 }}>
              <button
                className="ann-bubble ann-bubble--add"
                onClick={() => {
                  setFormState({ section: "", target: "", y: 0, mode: "note" });
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
            const y = annPositions.get(ann.id);
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
                  placeholder={formState.mode === "talking_point" ? "Add talking point…" : "Add your note…"}
                  value={formText}
                  onChange={(e) => setFormText(e.target.value)}
                  rows={formState.mode === "talking_point" ? 2 : 3}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setFormState(null);
                    if (e.key === "Enter" && e.metaKey) submitForm();
                  }}
                />
                <div className="ann-form-footer">
                  <span className="ann-form-mode">
                    {formState.mode === "talking_point" ? "talking point" : "note"}
                  </span>
                  <div className="ann-form-btns">
                    <button className="ann-form-cancel" onClick={() => setFormState(null)}>
                      Cancel
                    </button>
                    <button
                      className="ann-form-submit"
                      disabled={submitting || !formText.trim()}
                      onClick={submitForm}
                    >
                      {submitting ? "…" : formState.mode === "talking_point" ? "Add point" : "Add"}
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
