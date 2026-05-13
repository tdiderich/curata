"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import Link from "next/link";
import { PageContent } from "./page-viewer";
import { PublicToggle } from "./public-toggle";
import VersionHistory from "./version-history";
import AgentConnectModal from "./agent-connect-modal";
import { basePath } from "@/lib/api-fetch";

interface Annotation {
  id: string;
  text: string;
  author: string;
  section?: string;
  target?: string;
  kind?: "note" | "edit";
  replacement?: string;
  added: string;
  status: string;
  source: string;
}

interface FormState {
  mode: "note" | "edit";
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

function findSectionTop(
  root: HTMLElement,
  sectionName: string,
): number | null {
  const headings = root.querySelectorAll(".c-section-heading");
  for (const h of headings) {
    if (h.textContent?.trim() === sectionName) {
      const section = h.closest(".c-section");
      if (section) {
        const rootRect = root.getBoundingClientRect();
        const sectionRect = section.getBoundingClientRect();
        return sectionRect.top - rootRect.top;
      }
    }
  }
  return null;
}

export default function PageDetailClient({
  slug,
  children,
  annotations,
  sections,
  pageTitle,
  orgSlug,
  isPublic,
  autoConnect,
}: {
  slug: string;
  children?: React.ReactNode;
  annotations: Annotation[];
  sections: string[];
  pageTitle: string;
  orgSlug: string;
  isPublic: boolean;
  autoConnect: boolean;
}) {
  const router = useRouter();
  const contentRef = useRef<HTMLDivElement>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [expandAll, setExpandAll] = useState(false);
  const [annPositions, setAnnPositions] = useState(
    new Map<string, number>(),
  );
  const [mode, setMode] = useState<"annotate" | "edit">("annotate");
  const [formState, setFormState] = useState<FormState | null>(null);
  const [formText, setFormText] = useState("");
  const [formReplacement, setFormReplacement] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!actionsOpen) return;
    function handleClick(e: MouseEvent) {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) {
        setActionsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [actionsOpen]);

  useEffect(() => {
    if (!autoConnect) return;
    const key = `curata:agent-prompted:${slug}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
    setAgentOpen(true);
  }, [autoConnect, slug]);

  const activeAnns = useMemo(
    () =>
      annotations.filter(
        (a) =>
          showResolved ||
          (a.status !== "incorporated" && a.status !== "ignored"),
      ),
    [annotations, showResolved],
  );

  const resolvedCount = useMemo(
    () =>
      annotations.filter(
        (a) => a.status === "incorporated" || a.status === "ignored",
      ).length,
    [annotations],
  );

  // Highlight annotation targets in the DOM and compute Y positions
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

      if (y === null && ann.section) {
        y = findSectionTop(root, ann.section);
      }

      positions.set(ann.id, y ?? 40);
    }

    // De-overlap: push bubbles apart when they're too close
    const sorted = [...positions.entries()].sort((a, b) => a[1] - b[1]);
    const MIN_GAP = expandAll ? 120 : 36;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i][1] - sorted[i - 1][1] < MIN_GAP) {
        sorted[i][1] = sorted[i - 1][1] + MIN_GAP;
        positions.set(sorted[i][0], sorted[i][1]);
      }
    }

    setAnnPositions(positions);
  }, [activeAnns, expandAll]);

  // Click outside closes expanded card
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (target.closest(".ann-card") || target.closest(".ann-bubble")) return;
      setExpandedId(null);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const updateStatus = useCallback(
    async (id: string, status: "approved" | "incorporated" | "ignored") => {
      await fetch(`${basePath}/api/annotations`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, id, status }),
      });
      router.refresh();
    },
    [slug, router],
  );

  const openForm = useCallback(
    (mode: "note" | "edit", section: string, target: string) => {
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
      setFormState({ mode, section, target, y });
      setFormText("");
      setFormReplacement(mode === "edit" ? target : "");
      setExpandedId(null);
      window.getSelection()?.removeAllRanges();
    },
    [],
  );

  async function submitForm() {
    if (!formState) return;
    const isEdit = formState.mode === "edit";
    if (isEdit && !formReplacement.trim()) return;
    if (!isEdit && !formText.trim()) return;

    setSubmitting(true);

    if (isEdit) {
      await fetch(`${basePath}/api/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          target: formState.target,
          replacement: formReplacement.trim(),
        }),
      });
    } else {
      await fetch(`${basePath}/api/annotations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          text: formText.trim(),
          section: formState.section || undefined,
          target: formState.target || undefined,
        }),
      });
    }

    setFormState(null);
    setFormText("");
    setFormReplacement("");
    setSubmitting(false);
    router.refresh();
  }

  return (
    <div className="page-detail-layout">
      <div className="page-toolbar">
        <Link className="page-toolbar-back" href="/dashboard">
          &larr; Pages
        </Link>
        <div className="page-toolbar-spacer" />
        <div className="page-toolbar-right">
          <button
            className={`toolbar-mode-toggle${mode === "edit" ? " toolbar-mode-toggle--edit" : ""}`}
            onClick={() => setMode(mode === "annotate" ? "edit" : "annotate")}
          >
            <span className="toolbar-mode-track">
              <span className="toolbar-mode-thumb" />
            </span>
            <span className="toolbar-mode-label">
              {mode === "annotate" ? "Annotating" : "Editing"}
            </span>
          </button>
          <PublicToggle slug={slug} orgSlug={orgSlug} isPublic={isPublic} />
          <div className="page-toolbar-divider" />
          <div className="page-actions-wrap" ref={actionsRef}>
            <button
              className="page-actions-trigger"
              onClick={() => setActionsOpen((v) => !v)}
              title="More actions"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <circle cx="8" cy="3" r="1.5" />
                <circle cx="8" cy="8" r="1.5" />
                <circle cx="8" cy="13" r="1.5" />
              </svg>
            </button>
            {actionsOpen && (
              <div className="page-actions-menu">
                <button
                  className="page-actions-item"
                  onClick={() => { setAgentOpen(true); setActionsOpen(false); }}
                >
                  Add agent
                </button>
                <VersionHistory slug={slug} onOpen={() => setActionsOpen(false)} />
                <Link
                  href={`/pages/${slug}?edit=1`}
                  className="page-actions-item"
                  onClick={() => setActionsOpen(false)}
                >
                  Edit page contents
                </Link>
                {annotations.length > 0 && (
                  <>
                    <div className="page-actions-divider" />
                    <div className="page-actions-section">
                      <span className="page-actions-stat">
                        {activeAnns.length} annotation{activeAnns.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                    {resolvedCount > 0 && (
                      <button
                        className="page-actions-item"
                        onClick={() => { setShowResolved((v) => !v); setActionsOpen(false); }}
                      >
                        {showResolved ? "Hide" : "Show"} {resolvedCount} resolved
                      </button>
                    )}
                    {activeAnns.length > 0 && (
                      <button
                        className="page-actions-item"
                        onClick={() => { setExpandAll((v) => !v); setExpandedId(null); setActionsOpen(false); }}
                      >
                        {expandAll ? "Collapse all" : "Expand all"}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {agentOpen &&
        createPortal(
          <AgentConnectModal slug={slug} onClose={() => setAgentOpen(false)} />,
          document.body,
        )}

      <div className="page-content-wrap">
        <PageContent
          ref={contentRef}
          selectionAction={mode === "edit" ? "Replace" : "Annotate"}
          onTextSelect={(section, target) =>
            openForm(mode === "edit" ? "edit" : "note", section, target)
          }
        >
          {children}
        </PageContent>

        <div className="ann-margin" aria-label="Annotations">
          <div className="ann-marker" style={{ top: 0 }}>
            <button
              className="ann-bubble ann-bubble--add"
              onClick={() => {
                setFormState({ mode: "note", section: "", target: "", y: 0 });
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
          {activeAnns.map((ann) => {
            const y = annPositions.get(ann.id);
            if (y === undefined) return null;
            const isExpanded = expandAll || expandedId === ann.id;
            const done =
              ann.status === "incorporated" || ann.status === "ignored";

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
                  className={`ann-bubble${done ? " ann-bubble--resolved" : ""}${ann.status === "approved" ? " ann-bubble--approved" : ""}${ann.source === "agent" ? " ann-bubble--agent" : ""}`}
                  onClick={() => {
                    setExpandedId(isExpanded ? null : ann.id);
                    if (isExpanded) setHoveredId(null);
                  }}
                >
                  {ann.source === "agent"
                    ? "A"
                    : ann.author.charAt(0).toUpperCase()}
                </button>

                {showCard && (
                  <div className="ann-card">
                    <div className="ann-card-header">
                      <span className="ann-card-author">{ann.author}</span>
                      {ann.kind === "edit" && (
                        <span className="ann-card-kind">edit</span>
                      )}
                      {(ann.status === "approved" || done) && (
                        <span
                          className={`ann-card-badge${ann.status === "approved" ? " ann-card-badge--approved" : ""}`}
                        >
                          {ann.status}
                        </span>
                      )}
                      <span className="ann-card-age">
                        {daysAgo(ann.added)}d
                      </span>
                      <button
                        className="ann-card-close"
                        onClick={() => { setExpandedId(null); setHoveredId(null); }}
                      >
                        &times;
                      </button>
                    </div>
                    {ann.kind === "edit" && ann.target && ann.replacement ? (
                      <div className="ann-card-edit">
                        <span className="ann-card-del">{ann.target}</span>
                        <span className="ann-card-arrow">&rarr;</span>
                        <span className="ann-card-ins">
                          {ann.replacement}
                        </span>
                      </div>
                    ) : (
                      <div className="ann-card-text">{ann.text}</div>
                    )}
                    {!done && ann.status !== "approved" && (
                      <div className="ann-card-actions">
                        <button
                          className="ann-card-btn ann-card-btn--approve"
                          onClick={() => updateStatus(ann.id, "approved")}
                        >
                          Approve
                        </button>
                        <button
                          className="ann-card-btn ann-card-btn--ignore"
                          onClick={() => updateStatus(ann.id, "ignored")}
                        >
                          Ignore
                        </button>
                      </div>
                    )}
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
                    <span className="ann-form-target-label">
                      {formState.mode === "edit" ? "Original:" : "Re:"}
                    </span>
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
                  placeholder={
                    formState.mode === "edit"
                      ? "Type the corrected text…"
                      : "Add your note…"
                  }
                  value={
                    formState.mode === "edit" ? formReplacement : formText
                  }
                  onChange={(e) =>
                    formState.mode === "edit"
                      ? setFormReplacement(e.target.value)
                      : setFormText(e.target.value)
                  }
                  rows={3}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setFormState(null);
                    if (e.key === "Enter" && e.metaKey) submitForm();
                  }}
                />
                <div className="ann-form-footer">
                  <span className="ann-form-mode">{formState.mode}</span>
                  <div className="ann-form-btns">
                    <button
                      className="ann-form-cancel"
                      onClick={() => setFormState(null)}
                    >
                      Cancel
                    </button>
                    <button
                      className="ann-form-submit"
                      disabled={
                        submitting ||
                        (formState.mode === "edit"
                          ? !formReplacement.trim() ||
                            formReplacement.trim() === formState.target
                          : !formText.trim())
                      }
                      onClick={submitForm}
                    >
                      {submitting
                        ? "…"
                        : formState.mode === "edit"
                          ? "Save edit"
                          : "Add"}
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
