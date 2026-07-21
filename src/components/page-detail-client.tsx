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
import { useHighlights } from "@/hooks/use-highlights";
import { DeckControlContext } from "@/generated/kazam-renderer";
import { ContentRulesEditor } from "@/components/content-rules-editor";

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
  mode: "note" | "edit";
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

interface ContentRuleDisplay {
  id: string;
  text: string;
  mode: "warn" | "block";
  scope: string;
  patterns?: string[];
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
  inheritedRules = [],
  pageRules = [],
  pageSlug,
  canManageRules = false,
  canEditPageRules = false,
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
  inheritedRules?: ContentRuleDisplay[];
  pageRules?: ContentRuleDisplay[];
  pageSlug?: string;
  canManageRules?: boolean;
  canEditPageRules?: boolean;
}) {
  const router = useRouter();
  const contentRef = useRef<HTMLDivElement>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [expandAll, setExpandAll] = useState(false);
  const [formState, setFormState] = useState<FormState | null>(null);
  const [formText, setFormText] = useState("");
  const [formReplacement, setFormReplacement] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [agentOpen, setAgentOpen] = useState(false);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
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
          (!isDeck || !currentSlideLabel || !a.slide || a.slide === currentSlideLabel),
      ),
    [annotations, showResolved, isDeck, currentSlideLabel],
  );

  const resolvedCount = useMemo(
    () =>
      annotations.filter(
        (a) => a.status === "incorporated" || a.status === "ignored",
      ).length,
    [annotations],
  );

  const highlightTargets = useMemo(
    () => activeAnns.map((a) => ({ id: a.id, text: a.target ?? "", section: a.section })),
    [activeAnns],
  );

  const { positions: hlPositions, ranges: hlRanges } = useHighlights(
    contentRef,
    highlightTargets,
    { expandAll, isDeck },
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
    (mode: "note" | "edit", section: string, target: string, componentId: string = "") => {
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
              slide: isDeck ? currentSlideLabel || undefined : undefined,
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
                    else {
                      const wk = root as HTMLElement & { webkitRequestFullscreen?: () => void };
                      if (wk.webkitRequestFullscreen) wk.webkitRequestFullscreen();
                    }
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
                {(inheritedRules.length > 0 || pageRules.length > 0 || canEditPageRules) && (
                  <button
                    className="page-actions-item"
                    onClick={() => { setRulesOpen(true); setActionsOpen(false); }}
                  >
                    Content rules ({inheritedRules.length + pageRules.length})
                  </button>
                )}
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
      {rulesOpen &&
        createPortal(
          <div className="rules-panel-overlay" onClick={() => setRulesOpen(false)}>
            <div className="rules-panel" onClick={(e) => e.stopPropagation()}>
              <div className="rules-panel-header">
                <span className="rules-panel-title">Content Rules</span>
                <button className="rules-panel-close" onClick={() => setRulesOpen(false)}>&times;</button>
              </div>
              <div className="rules-panel-body">
                {inheritedRules.length > 0 && (
                  <div className="rules-panel-section">
                    <div className="rules-panel-section-label">Inherited</div>
                    {inheritedRules.map((rule) => (
                      <div key={rule.id} className="rules-panel-row">
                        <span className={`cr-dot cr-dot--${rule.mode}`} />
                        <div className="rules-panel-row-content">
                          <span className="rules-panel-row-text">{rule.text}</span>
                          <span className="rules-panel-row-scope">{rule.scope}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="rules-panel-section">
                  <div className="rules-panel-section-label">Page</div>
                  {canEditPageRules && pageSlug ? (
                    <div style={{ padding: "4px 20px 8px" }}>
                      <ContentRulesEditor
                        scopeParam={`scope=page:${pageSlug}`}
                        initialRules={pageRules.map(({ id, text, mode, patterns }) => ({ id, text, mode, patterns }))}
                        canManage={canEditPageRules}
                      />
                    </div>
                  ) : pageRules.length > 0 ? (
                    pageRules.map((rule) => (
                      <div key={rule.id} className="rules-panel-row">
                        <span className={`cr-dot cr-dot--${rule.mode}`} />
                        <div className="rules-panel-row-content">
                          <span className="rules-panel-row-text">{rule.text}</span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rules-panel-row" style={{ color: "var(--text-muted)", fontSize: 13, padding: "8px 20px" }}>
                      No page-level rules
                    </div>
                  )}
                </div>
              </div>
              {canManageRules && (
                <div className="rules-panel-footer">
                  <Link href="/settings?tab=content-rules" className="rules-panel-manage">
                    Manage global rules
                  </Link>
                </div>
              )}
            </div>
          </div>,
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
            { label: "Replace", onSelect: (section, target, componentId) => openForm("edit", section, target, componentId) },
          ]}
        >
          {isDeck ? (
            <DeckControlContext.Provider value={{ slide: slideIndex, onSlideChange: setSlideIndex }}>
              {children}
            </DeckControlContext.Provider>
          ) : children}
        </PageContent>

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
            const y = hlPositions.get(ann.id);
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
                {editError && (
                  <div style={{ color: "var(--color-error, #f87171)", fontSize: 12, padding: "4px 0" }}>
                    {editError}
                  </div>
                )}
                <div className="ann-form-footer">
                  <span className="ann-form-mode">
                    {formState.mode}
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
