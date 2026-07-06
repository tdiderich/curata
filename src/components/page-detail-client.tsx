"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import Link from "next/link";
import { PageContent } from "./page-viewer";
import { VisibilityPicker } from "./visibility-picker";
import { VersionHistoryPanel } from "./version-history";
import AgentConnectModal from "./agent-connect-modal";
import SourceEditor, { type SourceEditorControls } from "./source-editor";
import { toast } from "./toast";
import { basePath } from "@/lib/api-fetch";
import { highlightTarget, clearHighlights } from "@/lib/annotation-highlights";

interface Annotation {
  id: string;
  text: string;
  author: string;
  section?: string;
  target?: string;
  kind?: "note" | "edit" | "talking_point";
  replacement?: string;
  added: string;
  status: string;
  source: string;
  slide?: string;
}

interface FormState {
  mode: "note" | "edit" | "talking_point";
  section: string;
  target: string;
  componentId: string;
  y: number;
}

function daysAgo(dateStr: string): number {
  const d = new Date(dateStr);
  const now = new Date();
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
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
  pageTitle,
  orgSlug,
  visibility,
  autoConnect,
  authMode = "none",
  printFlow,
  shell,
  archived,
}: {
  slug: string;
  children?: React.ReactNode;
  annotations: Annotation[];
  sections?: string[];
  pageTitle?: string;
  orgSlug: string;
  visibility: string;
  autoConnect: boolean;
  authMode?: string;
  printFlow?: string;
  shell?: string;
  archived?: { since: string; supersededBy: string | null };
}) {
  const router = useRouter();
  const contentRef = useRef<HTMLDivElement>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [expandAll, setExpandAll] = useState(false);
  const [annPositions, setAnnPositions] = useState(
    new Map<string, number>(),
  );
  const [formState, setFormState] = useState<FormState | null>(null);
  const [formText, setFormText] = useState("");
  const [formReplacement, setFormReplacement] = useState("");
  const [showTalkingPoints, setShowTalkingPoints] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [agentOpen, setAgentOpen] = useState(false);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  const [viewTab, setViewTab] = useState<"preview" | "source">("preview");
  const [srcDirty, setSrcDirty] = useState(false);
  const [srcSaving, setSrcSaving] = useState(false);
  const srcControls = useRef<SourceEditorControls | null>(null);
  const onSourceState = useCallback((dirty: boolean, saving: boolean) => {
    setSrcDirty(dirty);
    setSrcSaving(saving);
  }, []);

  const [currentSlide, setCurrentSlide] = useState<string | null>(null);

  useEffect(() => {
    if (shell !== "deck") return;
    const handler = (e: Event) => {
      const label = (e as CustomEvent).detail?.label ?? null;
      setCurrentSlide(label);
    };
    document.addEventListener("deckslidechange", handler);
    const navLabel = document.querySelector(".deck-nav-label");
    if (navLabel?.textContent) setCurrentSlide(navLabel.textContent);
    return () => document.removeEventListener("deckslidechange", handler);
  }, [shell]);

  useEffect(() => {
    if (!printFlow) return;
    const cls = `print-${printFlow}`;
    document.body.classList.add(cls);
    return () => { document.body.classList.remove(cls); };
  }, [printFlow]);

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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAgentOpen(true);
  }, [autoConnect, slug]);

  // Record this page in the per-browser recently-viewed list that powers the
  // dashboard's "Jump back in" row.
  useEffect(() => {
    try {
      const raw = localStorage.getItem("curata-recent") ?? "[]";
      const list = JSON.parse(raw) as Array<{ slug: string; title: string; ts: number }>;
      const next = [
        { slug, title: pageTitle ?? slug, ts: Date.now() },
        ...list.filter((e) => e.slug !== slug),
      ].slice(0, 8);
      localStorage.setItem("curata-recent", JSON.stringify(next));
    } catch {
      // corrupted entry — drop the list rather than break page view
      localStorage.removeItem("curata-recent");
    }
  }, [slug, pageTitle]);

  const activeAnns = useMemo(
    () =>
      annotations.filter(
        (a) =>
          a.kind !== "talking_point" &&
          (showResolved ||
          (a.status !== "incorporated" && a.status !== "ignored")) &&
          (shell !== "deck" || !currentSlide || !a.slide || a.slide === currentSlide),
      ),
    [annotations, showResolved, shell, currentSlide],
  );

  const talkingPoints = useMemo(
    () =>
      annotations.filter(
        (a) =>
          a.kind === "talking_point" &&
          a.status !== "incorporated" && a.status !== "ignored" &&
          (shell !== "deck" || !currentSlide || !a.slide || a.slide === currentSlide),
      ),
    [annotations, shell, currentSlide],
  );

  const resolvedCount = useMemo(
    () =>
      annotations.filter(
        (a) => a.status === "incorporated" || a.status === "ignored",
      ).length,
    [annotations],
  );

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
        if (y === null && ann.section) {
          y = findSectionTop(root, ann.section);
        }
        positions.set(ann.id, y ?? 40);
      }
    }

    const sorted = [...positions.entries()].sort((a, b) => a[1] - b[1]);
    const MIN_GAP = expandAll ? 120 : 36;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i][1] - sorted[i - 1][1] < MIN_GAP) {
        sorted[i][1] = sorted[i - 1][1] + MIN_GAP;
        positions.set(sorted[i][0], sorted[i][1]);
      }
    }

    setAnnPositions(positions);
    setTpPositions(tpPos);
  }, [activeAnns, talkingPoints, expandAll]);

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

  const updateStatus = useCallback(
    async (id: string, status: "approved" | "incorporated" | "ignored") => {
      try {
        const res = await fetch(`${basePath}/api/annotations`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug, id, status }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          toast.error(`Couldn't update annotation: ${data.error ?? "unknown error"}`);
        }
      } catch {
        toast.error("Couldn't update annotation — check your connection and try again.");
      }
      router.refresh();
    },
    [slug, router],
  );

  const openForm = useCallback(
    (mode: "note" | "edit" | "talking_point", section: string, target: string, componentId: string = "") => {
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
      setFormState({ mode, section, target, componentId, y });
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
    setEditError(null);

    try {
      const res = isEdit
        ? await fetch(`${basePath}/api/edit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              slug,
              target: formState.target,
              replacement: formReplacement.trim(),
              componentId: formState.componentId || undefined,
            }),
          })
        : await fetch(`${basePath}/api/annotations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              slug,
              text: formText.trim(),
              section: formState.section || undefined,
              target: formState.target || undefined,
              slide: shell === "deck" ? currentSlide || undefined : undefined,
              kind: formState.mode === "talking_point" ? "talking_point" : undefined,
            }),
          });

      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setEditError(json.error ?? "Failed to save");
        setSubmitting(false);
        return;
      }
    } catch {
      setEditError("Network error");
      setSubmitting(false);
      return;
    }

    setFormState(null);
    setFormText("");
    setFormReplacement("");
    setSubmitting(false);
    router.refresh();
  }

  async function restorePage() {
    try {
      const res = await fetch(`${basePath}/api/pages`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, status: "active" }),
      });
      if (res.ok) {
        toast.success("Page restored");
        router.refresh();
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(`Couldn't restore page: ${data.error ?? "unknown error"}`);
      }
    } catch {
      toast.error("Couldn't restore page — check your connection and try again.");
    }
  }

  async function handleExport(format: "png" | "pdf") {
    toast.success(`Generating ${format.toUpperCase()}…`);
    try {
      const res = await fetch(`${basePath}/api/export?slug=${encodeURIComponent(slug)}&format=${format}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Export failed" }));
        toast.error(data.error || "Export failed");
        return;
      }
      const cd = res.headers.get("Content-Disposition") ?? "";
      const match = cd.match(/filename="?([^"]+)"?/);
      const filename = match?.[1] ?? `${slug}.${format}`;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`${format.toUpperCase()} downloaded`);
    } catch {
      toast.error("Export failed — check your connection and try again.");
    }
  }

  return (
    <div className="page-detail-layout">
      {archived && (
        <div className="archived-banner" role="status">
          <span>
            Archived {archived.since}
            {archived.supersededBy && (
              <> — superseded by <Link href={`/pages/${archived.supersededBy}`} className="archived-banner-link">{archived.supersededBy}</Link></>
            )}
            . Hidden from lists, search, and agents.
          </span>
          <button className="archived-banner-restore" onClick={restorePage}>Restore</button>
        </div>
      )}
      <div className="page-toolbar">
        {pageTitle && <span className="page-toolbar-title">{pageTitle}</span>}
        <div className="page-toolbar-spacer" />
        <div className="page-toolbar-right">
          {viewTab === "source" ? (
            <>
              {srcDirty && (
                <button
                  className="view-tab"
                  onClick={() => {
                    if (confirm("Discard unsaved changes?")) srcControls.current?.discard();
                  }}
                >
                  Discard
                </button>
              )}
              <button
                className="view-tab view-tab--active"
                disabled={srcSaving}
                onClick={() => {
                  // One state-aware button: saves when dirty, exits when clean.
                  if (srcDirty) srcControls.current?.save();
                  else setViewTab("preview");
                }}
              >
                {srcSaving ? "Saving…" : srcDirty ? "Save" : "Done"}
              </button>
            </>
          ) : (
            <>
              {shell === "deck" && (
                <button
                  className="deck-present-btn"
                  onClick={() => {
                    const root = document.querySelector(".deck-root") as HTMLElement | null;
                    if (root?.requestFullscreen) root.requestFullscreen();
                    else if ((root as any)?.webkitRequestFullscreen) (root as any).webkitRequestFullscreen();
                  }}
                >
                  Present
                </button>
              )}
              <button className="view-tab" onClick={() => setViewTab("source")}>
                Edit
              </button>
            </>
          )}
          <VisibilityPicker slug={slug} orgSlug={orgSlug} visibility={visibility} authMode={authMode} />
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
                <button
                  className="page-actions-item"
                  onClick={() => { setVersionHistoryOpen(true); setActionsOpen(false); }}
                >
                  Revert to past version
                </button>
                <Link
                  href={`/pages/${slug}?edit=1`}
                  className="page-actions-item"
                  onClick={() => setActionsOpen(false)}
                >
                  Form editor
                </Link>
                <div className="page-actions-divider" />
                <button
                  className="page-actions-item"
                  onClick={() => { handleExport("png"); setActionsOpen(false); }}
                >
                  Export PNG
                </button>
                <button
                  className="page-actions-item"
                  onClick={() => { handleExport("pdf"); setActionsOpen(false); }}
                >
                  Export PDF
                </button>
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
          <AgentConnectModal slug={slug} onClose={() => setAgentOpen(false)} authMode={authMode} />,
          document.body,
        )}
      {versionHistoryOpen &&
        createPortal(
          <VersionHistoryPanel slug={slug} onClose={() => setVersionHistoryOpen(false)} />,
          document.body,
        )}

      {viewTab === "source" ? (
        <SourceEditor
          slug={slug}
          onSaved={() => {
            toast.success("Page saved");
            setViewTab("preview");
          }}
          onStateChange={onSourceState}
          controlsRef={srcControls}
        />
      ) : (
      <div className="page-content-wrap">
        <PageContent
          ref={contentRef}
          selectionActions={[
            { label: "Annotate", onSelect: (section, target, componentId) => openForm("note", section, target, componentId) },
            { label: "Talking Point", onSelect: (section, target, componentId) => openForm("talking_point", section, target, componentId) },
            { label: "Replace", onSelect: (section, target, componentId) => openForm("edit", section, target, componentId) },
          ]}
        >
          {children}
        </PageContent>

        {showTalkingPoints && contentRef.current && (() => {
          const container = contentRef.current!;
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
          <div className="ann-marker" style={{ top: 0 }}>
            <button
              className="ann-bubble ann-bubble--add"
              onClick={() => {
                setFormState({ mode: "note", section: "", target: "", componentId: "", y: 0 });
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
                onMouseEnter={() => { if (hoverTimeout.current) clearTimeout(hoverTimeout.current); setHoveredId(ann.id); }}
                onMouseLeave={() => { hoverTimeout.current = setTimeout(() => setHoveredId(null), 300); }}
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
                      : formState.mode === "talking_point"
                        ? "Add talking point…"
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
                  rows={formState.mode === "talking_point" ? 2 : 3}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setFormState(null);
                    if (e.key === "Enter" && e.metaKey) submitForm();
                  }}
                />
                {editError && (
                  <div style={{ color: "var(--color-error, #f87171)", fontSize: 12, padding: "4px 0" }}>
                    {editError}
                  </div>
                )}
                <div className="ann-form-footer">
                  <span className="ann-form-mode">
                    {formState.mode === "talking_point" ? "talking point" : formState.mode}
                  </span>
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
                          : formState.mode === "talking_point"
                            ? "Add point"
                            : "Add"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
}
