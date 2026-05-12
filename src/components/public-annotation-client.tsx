"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PageContent } from "./page-viewer";

interface Annotation {
  id: string;
  text: string;
  author: string;
  section?: string;
  target?: string;
  added: string;
  status: string;
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

function highlightTarget(
  root: HTMLElement,
  target: string,
  annId: string,
): HTMLElement | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let textNode: Text | null;
  while ((textNode = walker.nextNode() as Text | null)) {
    const content = textNode.textContent || "";
    const idx = content.indexOf(target);
    if (idx === -1) continue;
    try {
      const range = document.createRange();
      range.setStart(textNode, idx);
      range.setEnd(textNode, idx + target.length);
      const mark = document.createElement("mark");
      mark.className = "ann-target-highlight";
      mark.dataset.ann = annId;
      range.surroundContents(mark);
      return mark;
    } catch {
      continue;
    }
  }
  return null;
}

function clearHighlights(root: HTMLElement) {
  root.querySelectorAll("mark.ann-target-highlight").forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
  });
  root.normalize();
}

export default function PublicAnnotationClient({
  orgSlug,
  pageSlug,
  children,
  annotations,
  isSignedIn,
}: {
  orgSlug: string;
  pageSlug: string;
  children?: React.ReactNode;
  annotations: Annotation[];
  isSignedIn: boolean;
}) {
  const router = useRouter();
  const contentRef = useRef<HTMLDivElement>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [annPositions, setAnnPositions] = useState(new Map<string, number>());
  const [formState, setFormState] = useState<FormState | null>(null);
  const [formText, setFormText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const activeAnns = useMemo(
    () => annotations.filter((a) => a.status !== "incorporated" && a.status !== "ignored"),
    [annotations],
  );

  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;

    clearHighlights(root);
    const positions = new Map<string, number>();

    for (const ann of activeAnns) {
      let y: number | null = null;

      if (ann.target) {
        const mark = highlightTarget(root, ann.target, ann.id);
        if (mark) {
          const rootRect = root.getBoundingClientRect();
          const markRect = mark.getBoundingClientRect();
          y = markRect.top - rootRect.top;
        }
      }

      positions.set(ann.id, y ?? 40);
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
  }, [activeAnns]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (target.closest(".ann-card") || target.closest(".ann-bubble")) return;
      setExpandedId(null);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
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

    await fetch("/api/public-annotations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orgSlug,
        pageSlug,
        text: formText.trim(),
        section: formState.section || undefined,
        target: formState.target || undefined,
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
          selectionAction={isSignedIn ? "Annotate" : undefined}
          onTextSelect={isSignedIn ? (section, target) => openForm(section, target) : undefined}
        >
          {children}
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
            const y = annPositions.get(ann.id);
            if (y === undefined) return null;
            const isExpanded = expandedId === ann.id;
            const showCard = isExpanded || hoveredId === ann.id;

            return (
              <div
                key={ann.id}
                className="ann-marker"
                style={{ top: y }}
                onMouseEnter={() => setHoveredId(ann.id)}
                onMouseLeave={() => setHoveredId(null)}
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
