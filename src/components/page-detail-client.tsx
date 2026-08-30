"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import Link from "next/link";
import { PageContent, type ReorderEvent } from "./page-viewer";
import { VisibilityPicker } from "./visibility-picker";
import { registerPageActions, type PageAction } from "@/lib/page-actions";
import { PageActionDock } from "./page-action-dock";
import { InPlaceEditLayer } from "./in-place-edit-layer";
import { VersionHistoryPanel } from "./version-history";
import AgentConnectModal from "./agent-connect-modal";
import SourceEditor, { type SourceEditorControls } from "./source-editor";
import { toast } from "./toast";
import { TrustBanner, type TrustBannerProps } from "./trust-banner";
import { basePath } from "@/lib/api-fetch";
import { copyPagesForAgent } from "@/lib/copy-for-agent";
import { useHighlights } from "@/hooks/use-highlights";
import { DeckControlContext, PageRenderer, type PageData, type ComponentData } from "@/generated/kazam-renderer";
import { EditableComponent } from "./editable-component";
import { AddComponentButton } from "./add-component-button";
import { ContentRulesEditor } from "@/components/content-rules-editor";
import { ApprovalRuleEditor, type ApprovalApproverInput } from "@/components/approval-rule-editor";
import VisualComponentEditor from "./visual-component-editor";

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
  pageApprovers = null,
  approvalEffectiveNote = null,
  tagsRow,
  trustBanner,
  autoTrust,
  trustMode: trustModeProp,
  hasTrustRuleAtScope,
  pageJson,
  readOnly = false,
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
  pageApprovers?: ApprovalApproverInput[] | null;
  approvalEffectiveNote?: string | null;
  tagsRow?: React.ReactNode;
  trustBanner?: Omit<TrustBannerProps, "slug">;
  autoTrust?: boolean;
  trustMode?: "auto" | "locked";
  hasTrustRuleAtScope?: boolean;
  pageJson?: PageData;
  readOnly?: boolean;
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
  const [submitting, setSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [agentOpen, setAgentOpen] = useState(false);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [viewTab, setViewTab] = useState<"preview" | "source">("preview");
  const [editMode, setEditMode] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editingComponent, setEditingComponent] = useState<{ id: string; type: string } | null>(null);
  const [localComponents, setLocalComponents] = useState<Record<string, unknown>[]>(() =>
    pageJson?.components ? JSON.parse(JSON.stringify(pageJson.components)) : [],
  );
  const [editDirty, setEditDirty] = useState(false);
  const initialMeta = useCallback(() => ({
    title: (pageTitle ?? (pageJson?.title as string | undefined) ?? "") as string,
    subtitle: ((pageJson?.subtitle as string | undefined) ?? "") as string,
  }), [pageTitle, pageJson]);
  const [localMeta, setLocalMeta] = useState<{ title: string; subtitle: string }>(initialMeta);
  const [requestEdit, setRequestEdit] = useState<{ path: Array<string | number>; seq: number } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const isDragging = draggingId !== null;
  const [srcDirty, setSrcDirty] = useState(false);
  const [srcSaving, setSrcSaving] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const srcControls = useRef<SourceEditorControls | null>(null);
  const onSourceState = useCallback((dirty: boolean, saving: boolean) => {
    setSrcDirty(dirty);
    setSrcSaving(saving);
  }, []);

  const isDeck = shell === "deck";

  const presentationConfig = (pageJson as Record<string, unknown> | undefined)?.presentation as
    | { breaks?: number[]; labels?: string[] }
    | undefined;
  const presentationSlides = useMemo(() => {
    if (!presentationConfig?.breaks?.length || !pageJson?.components?.length) return null;
    const comps = pageJson.components as Array<Record<string, unknown>>;
    const breaks = [0, ...presentationConfig.breaks].filter((b) => b < comps.length);
    const labels = presentationConfig.labels ?? [];
    return breaks.map((start, i) => {
      const end = i + 1 < breaks.length ? breaks[i + 1] : comps.length;
      return {
        components: comps.slice(start, end).filter((c) => c.type !== "divider"),
        label: labels[i] ?? "",
      };
    });
  }, [presentationConfig, pageJson?.components]);
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
    (section: string, target: string, componentId: string = "") => {
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
      setFormState({ section, target, componentId, y });
      setFormText("");
      setExpandedId(null);
      window.getSelection()?.removeAllRanges();
    },
    [],
  );

  async function submitForm() {
    if (!formState) return;
    if (!formText.trim()) return;

    setSubmitting(true);
    setEditError(null);

    try {
      const res = await fetch(`${basePath}/api/annotations`, {
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
    setSubmitting(false);
    router.refresh();
  }

  const handleEditComponent = useCallback((componentId: string, componentType: string) => {
    setEditingComponent({ id: componentId, type: componentType });
  }, []);

  const handleReorder = useCallback((event: ReorderEvent) => {
    setLocalComponents((prev) => {
      // Resolve both ids against the pre-move order: id-less components are
      // addressed as c-<index>, and indices shift once the source is removed.
      const find = (id: string) => prev.findIndex((c, i) => (c.id as string) === id || `c-${i}` === id);
      const srcIdx = find(event.componentId);
      const targetIdx = find(event.targetId);
      if (srcIdx === -1 || targetIdx === -1 || srcIdx === targetIdx) return prev;
      const arr = [...prev];
      const [moved] = arr.splice(srcIdx, 1);
      const destIdx = targetIdx > srcIdx ? targetIdx - 1 : targetIdx;
      const insertAt = event.position === "before" ? destIdx : destIdx + 1;
      arr.splice(insertAt, 0, moved);
      return arr;
    });
    setEditDirty(true);
  }, []);

  const handleDeleteComponent = useCallback((componentId: string) => {
    setLocalComponents((prev) => {
      const idx = prev.findIndex((c, i) => (c.id as string) === componentId || `c-${i}` === componentId);
      if (idx === -1) return prev;
      const arr = [...prev];
      arr.splice(idx, 1);
      return arr;
    });
    setEditDirty(true);
  }, []);

  const handleAddComponent = useCallback((component: Record<string, unknown>) => {
    setLocalComponents((prev) => [...prev, component]);
    setEditDirty(true);
  }, []);

  const handleLocalComponentSave = useCallback((componentId: string, parsed: Record<string, unknown>) => {
    setLocalComponents((prev) => {
      const arr = [...prev];
      const idx = arr.findIndex((c, i) => (c.id as string) === componentId || `c-${i}` === componentId);
      if (idx === -1) return prev;
      parsed.id = arr[idx].id ?? componentId;
      arr[idx] = parsed;
      return arr;
    });
    setEditDirty(true);
  }, []);

  const saveAllEdits = useCallback(async () => {
    setEditSaving(true);
    try {
      const res = await fetch(`${basePath}/api/pages/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          op: "replace-all",
          components: localComponents,
          title: localMeta.title.trim() || undefined,
          subtitle: localMeta.subtitle.trim() || null,
          autoTrust,
        }),
      });
      if (res.ok) {
        setEditDirty(false);
        setEditingComponent(null);
        setEditMode(false);
        router.refresh();
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Save failed");
      }
    } catch {
      toast.error("Save failed");
    }
    setEditSaving(false);
  }, [slug, localComponents, localMeta, autoTrust, router]);

  // Undo / redo for edit mode. Every localComponents change (in-place edit,
  // reorder, delete, add, sheet save) lands in history; Cmd+Z walks it back.
  type EditSnapshot = { c: Record<string, unknown>[]; m: { title: string; subtitle: string } };
  const historyRef = useRef<{ past: EditSnapshot[]; future: EditSnapshot[]; last: EditSnapshot; skip: boolean }>({
    past: [], future: [], last: { c: localComponents, m: localMeta }, skip: false,
  });
  useEffect(() => {
    const h = historyRef.current;
    const snap = { c: localComponents, m: localMeta };
    if (!editMode) { h.past = []; h.future = []; h.last = snap; h.skip = false; return; }
    if (h.skip) { h.skip = false; h.last = snap; return; }
    if (h.last.c !== localComponents || h.last.m !== localMeta) {
      h.past.push(h.last);
      if (h.past.length > 100) h.past.shift();
      h.future = [];
      h.last = snap;
    }
  }, [localComponents, localMeta, editMode]);
  useEffect(() => {
    if (!editMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable || t.closest(".cm-editor"))) return;
      const h = historyRef.current;
      const from = e.shiftKey ? h.future : h.past;
      if (from.length === 0) return;
      e.preventDefault();
      const next = from.pop()!;
      (e.shiftKey ? h.past : h.future).push(h.last);
      h.skip = true;
      setLocalComponents(next.c);
      setLocalMeta(next.m);
      setEditDirty(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editMode]);

  const discardEdits = useCallback(() => {
    if (editDirty && !confirm("Discard all unsaved edits?")) return;
    setLocalComponents(pageJson?.components ? JSON.parse(JSON.stringify(pageJson.components)) : []);
    setLocalMeta(initialMeta());
    setEditDirty(false);
    setEditingComponent(null);
    setEditMode(false);
  }, [editDirty, pageJson, initialMeta]);

  const pageEditData = useMemo(
    () => ({ title: localMeta.title, subtitle: localMeta.subtitle, components: localComponents }),
    [localComponents, localMeta],
  );
  const handleInPlaceChange = useCallback((next: Record<string, unknown>) => {
    setLocalComponents(next.components as Record<string, unknown>[]);
    setLocalMeta({ title: String(next.title ?? ""), subtitle: String(next.subtitle ?? "") });
    setEditDirty(true);
  }, []);
  const inPlaceBindingGroup = useCallback((path: Array<string | number>, data: Record<string, unknown>) => {
    if (path[0] === "title" || path[0] === "subtitle") return "meta";
    if (path[0] !== "components" || typeof path[1] !== "number") return null;
    const comps = data.components as Record<string, unknown>[];
    return (comps[path[1]]?.id as string) || `c-${path[1]}`;
  }, []);
  const inPlaceHoverGroup = useCallback((el: Element) => {
    if (el.closest(".page-hero")) return "meta";
    const wrapper = el.closest<HTMLElement>("[data-component-id]");
    return wrapper?.dataset.componentId ?? null;
  }, []);
  const contentWrapRef = useRef<HTMLDivElement>(null);
  const editRootRef = useRef<HTMLDivElement>(null);

  const handleDragStart = useCallback((id: string) => { setDraggingId(id); }, []);
  const handleDragEnd = useCallback(() => { setDraggingId(null); }, []);

  const ComponentWrapper = useMemo(() => {
    return function Wrapper({ comp, index, children: cv }: { comp: ComponentData; index: number; children: React.ReactNode }) {
      return (
        <EditableComponent
          comp={comp}
          index={index}
          onEdit={handleEditComponent}
          onDelete={handleDeleteComponent}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          editingId={editingComponent?.id ?? null}
          draggingId={draggingId}
        >
          {cv}
        </EditableComponent>
      );
    };
  }, [handleEditComponent, handleDeleteComponent, handleDragStart, handleDragEnd, editingComponent?.id, draggingId]);

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

  // Track native fullscreen (deck "Present" button) so the dock gets out of the way.
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  // One list drives both the ⌘K palette and the floating dock.
  const pageActions = useMemo<PageAction[]>(() => {
    if (viewTab !== "preview") return [];
    return [
      ...(readOnly ? [] : [{
        id: "edit-inline",
        label: editMode ? (editDirty ? "Save edits" : "Done editing") : "Edit page",
        icon: (editMode ? (editDirty ? "save" : "check") : "edit") as PageAction["icon"],
        primary: editMode,
        run: () => {
          if (editMode) {
            if (editDirty) saveAllEdits();
            else { setEditingComponent(null); setEditMode(false); }
          } else {
            setLocalComponents(
              pageJson?.components ? JSON.parse(JSON.stringify(pageJson.components)) : [],
            );
            setLocalMeta(initialMeta());
            setEditDirty(false);
            setEditMode(true);
          }
        },
      }]),
      {
        id: "copy-agent",
        label: "Copy for agent",
        hint: "with MCP info",
        icon: "copy" as const,
        run: () => {
          copyPagesForAgent(pageTitle ?? slug, [{ slug, title: pageTitle ?? slug }]).then((result) => {
            if (result === "ok") toast.success(`Copied "${pageTitle ?? slug}" for an agent`);
            else toast.error("Couldn't copy — check your connection and try again");
          });
        },
      },
      ...(editMode ? [{ id: "discard-edits", label: editDirty ? "Discard edits" : "Exit without changes", icon: "discard" as const, run: discardEdits }] : []),
      ...(presentationSlides ? [{ id: "present", label: "Present", icon: "present" as const, run: () => setPresenting(true) }] : []),
      { id: "export-pdf", label: "Export PDF", icon: "pdf" as const, run: () => handleExport("pdf") },
      ...(readOnly ? [] : [{ id: "page-settings", label: "Page settings", icon: "settings" as const, run: () => router.push(`/pages/${slug}/settings`) }]),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewTab, slug, editMode, editDirty, readOnly, presentationSlides, saveAllEdits, discardEdits]);

  useEffect(() => {
    if (viewTab !== "preview") return;
    return registerPageActions(pageActions);
  }, [viewTab, pageActions]);

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
      {trustBanner && <TrustBanner slug={slug} {...trustBanner} />}
      {viewTab === "source" ? (
        <div className="page-toolbar">
          {pageTitle && <span className="page-toolbar-title">{pageTitle}</span>}
          <div className="page-toolbar-spacer" />
          <div className="page-toolbar-right">
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
                if (srcDirty) srcControls.current?.save();
                else setViewTab("preview");
              }}
            >
              {srcSaving ? "Saving…" : srcDirty ? "Save" : "Done"}
            </button>
          </div>
        </div>
      ) : (
        null
      )}
      {agentOpen &&
        createPortal(
          <AgentConnectModal slug={slug} onClose={() => setAgentOpen(false)} authMode={authMode} />,
          document.body,
        )}
      {versionHistoryOpen &&
        createPortal(
          <VersionHistoryPanel
            slug={slug}
            onClose={() => setVersionHistoryOpen(false)}
            canApprove={trustBanner?.canApprove ?? true}
            approversNote={trustBanner?.approversNote ?? null}
          />,
          document.body,
        )}
      {rulesOpen &&
        createPortal(
          <div className="agent-overlay" onClick={() => setRulesOpen(false)}>
            <div className="agent-modal" onClick={(e) => e.stopPropagation()}>
              <div className="agent-modal-header">
                <span className="agent-modal-title">Content rules</span>
                <button className="agent-modal-close" onClick={() => setRulesOpen(false)}>&#x2715;</button>
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
                {pageSlug && (
                  <div className="rules-panel-section">
                    <div className="rules-panel-section-label">Approval</div>
                    <ApprovalRuleEditor
                      scopeParam={`scope=page:${pageSlug}`}
                      initialApprovers={pageApprovers}
                      effectiveNote={approvalEffectiveNote}
                      canManage={canEditPageRules}
                      trustMode={trustModeProp}
                      hasTrustRuleAtScope={hasTrustRuleAtScope}
                    />
                  </div>
                )}
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
          autoTrust={autoTrust}
          onSaved={() => {
            toast.success("Page saved");
            setViewTab("preview");
          }}
          onStateChange={onSourceState}
          controlsRef={srcControls}
        />
      ) : (
      <div className="page-content-wrap" ref={contentWrapRef}>
       <div ref={editRootRef} className="page-edit-root">
        {viewTab === "preview" && (
          <div className="page-hero" data-kz-path="">
            <div className="page-hero-identity">
              {shell !== "hub" && (editMode ? localMeta.title : pageTitle) && (
                <h1 className="page-hero-title" data-kz-field="title">{editMode ? localMeta.title : pageTitle}</h1>
              )}
              {shell !== "hub" && (editMode ? localMeta.subtitle : pageJson?.subtitle) && (
                <p className="page-hero-subtitle" data-kz-field="subtitle">{editMode ? localMeta.subtitle : pageJson?.subtitle}</p>
              )}
              {shell !== "hub" && editMode && !localMeta.subtitle && (
                <p
                  className="page-hero-subtitle page-hero-subtitle--placeholder"
                  onClick={() => {
                    setLocalMeta((m) => ({ ...m, subtitle: "Subtitle" }));
                    setEditDirty(true);
                    setRequestEdit((r) => ({ path: ["subtitle"], seq: (r?.seq ?? 0) + 1 }));
                  }}
                >
                  Add a subtitle
                </p>
              )}
              {shell !== "hub" && <div className="page-hero-tags">{tagsRow}</div>}
            </div>
            <VisibilityPicker slug={slug} orgSlug={orgSlug} visibility={visibility} authMode={authMode} hideTrigger />
            {shell === "deck" && (
              <button
                className="btn btn--ghost"
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
          </div>
        )}
        <PageContent
          ref={contentRef}
          editMode={editMode}
          onReorder={editMode ? handleReorder : undefined}
          selectionActions={editMode ? [] : [
            { label: "Comment", onSelect: (section, target, componentId) => openForm(section, target, componentId) },
          ]}
        >
          {editMode && pageJson ? (
            <>
              <PageRenderer
                page={{ ...pageJson!, components: localComponents as PageData["components"] }}
                componentWrapper={ComponentWrapper}
              />
              <AddComponentButton onAdd={handleAddComponent} disabled={editSaving} />
            </>
          ) : isDeck ? (
            <DeckControlContext.Provider value={{ slide: slideIndex, onSlideChange: setSlideIndex }}>
              {children}
            </DeckControlContext.Provider>
          ) : children}
        </PageContent>
       </div>
        {editMode && pageJson && (
          <InPlaceEditLayer
            rootRef={editRootRef}
            containerRef={contentWrapRef}
            data={pageEditData}
            onChange={handleInPlaceChange}
            enabled={editMode && !editingComponent && !isDragging}
            bindingGroup={inPlaceBindingGroup}
            hoverGroup={inPlaceHoverGroup}
            requestEdit={requestEdit}
          />
        )}
        {editingComponent && (
          <VisualComponentEditor
            slug={slug}
            componentId={editingComponent.id}
            componentType={editingComponent.type}
            pageJson={pageJson}
            autoTrust={autoTrust}
            onClose={() => setEditingComponent(null)}
            onSaved={() => setEditingComponent(null)}
            initialComponent={(() => {
              const idx = localComponents.findIndex((c, i) =>
                (c.id as string) === editingComponent.id || `c-${i}` === editingComponent.id,
              );
              if (idx === -1) return undefined;
              const comp = { ...localComponents[idx] };
              delete comp.id;
              return comp;
            })()}
            onLocalSave={handleLocalComponentSave}
          />
        )}

        <div className="ann-margin" aria-label="Annotations">
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
                          className={`pill ann-card-badge${ann.status === "approved" ? " ann-card-badge--approved" : ""}`}
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
                  placeholder="Add your comment…"
                  value={formText}
                  onChange={(e) => setFormText(e.target.value)}
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
                  <span className="ann-form-mode">comment</span>
                  <div className="ann-form-btns">
                    <button
                      className="ann-form-cancel"
                      onClick={() => setFormState(null)}
                    >
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
      )}
      {viewTab === "preview" && (
        <PageActionDock actions={pageActions} hidden={presenting || isFullscreen || editingComponent !== null} />
      )}
      {presenting && presentationSlides && createPortal(
        <PresentationOverlay
          slides={presentationSlides}
          pageTitle={pageTitle ?? slug}
          pageJson={pageJson!}
          onClose={() => setPresenting(false)}
        />,
        document.body,
      )}
    </div>
  );
}

function PresentationOverlay({
  slides,
  pageTitle,
  pageJson,
  onClose,
}: {
  slides: Array<{ components: Array<Record<string, unknown>>; label: string }>;
  pageTitle: string;
  pageJson: PageData;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState(0);
  const total = slides.length;

  const go = useCallback(
    (dir: 1 | -1) => setCurrent((c) => Math.max(0, Math.min(total - 1, c + dir))),
    [total],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); go(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
      else if (e.key === "Home") { e.preventDefault(); setCurrent(0); }
      else if (e.key === "End") { e.preventDefault(); setCurrent(total - 1); }
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [go, onClose, total]);

  const slide = slides[current];

  return (
    <div className="pres-overlay" onClick={onClose}>
      <div className="pres-viewport" onClick={(e) => e.stopPropagation()}>
        <div className="pres-header">
          <span className="pres-title">{pageTitle}</span>
          {slide.label && <span className="pres-slide-label">{slide.label}</span>}
          <span className="pres-counter">{current + 1} / {total}</span>
          <button className="pres-close" onClick={onClose} aria-label="Exit presentation">&times;</button>
        </div>
        <div className="pres-body">
          <PageRenderer
            page={{
              ...pageJson,
              shell: "standard",
              components: slide.components as PageData["components"],
              slides: undefined,
              hub: undefined,
            }}
          />
        </div>
        <div className="pres-nav">
          <button className="pres-nav-btn" disabled={current === 0} onClick={() => go(-1)} aria-label="Previous slide">&larr;</button>
          <div className="pres-dots">
            {slides.map((_, i) => (
              <button
                key={i}
                className={`pres-dot${i === current ? " pres-dot--active" : ""}`}
                onClick={() => setCurrent(i)}
                aria-label={`Slide ${i + 1}`}
              />
            ))}
          </div>
          <button className="pres-nav-btn" disabled={current === total - 1} onClick={() => go(1)} aria-label="Next slide">&rarr;</button>
        </div>
      </div>
    </div>
  );
}
