"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ActionBarFolder, ActionBarPage } from "@/components/action-bar-types";
import { PageActionDock } from "@/components/page-action-dock";
import type { PageAction } from "@/lib/page-actions";
import { ContextMenu, type ContextMenuItem } from "@/components/context-menu";
import { readPinsSeeded } from "@/lib/pins";
import { copyPagesForAgent, copyReferenceForAgent as copyRefsForAgent } from "@/lib/copy-for-agent";
import { toast } from "@/components/toast";
import { basePath } from "@/lib/api-fetch";
import ReportBuilder from "@/components/report-builder";
import { NewPageButton } from "@/components/new-page-button";
import { ConfirmDeleteModal } from "@/components/confirm-delete-modal";
import { kindSlug } from "@/lib/concept-kinds";

interface VocabConcept {
  term: string;
  kind: string;
  usageCount: number;
}

interface SemanticResult {
  concepts: Array<{ term: string; kind: string; usageCount: number }>;
  pages: Array<{ slug: string; title: string; sharedConcepts: string[] }>;
}

interface ActionBarHomeProps {
  vocabulary: { concepts: VocabConcept[]; kinds: string[] };
  folders: ActionBarFolder[];
  pages: ActionBarPage[];
  orgName: string;
  logoUrl: string | null;
  quickRefs?: string[];
}

const SEARCH_PLACEHOLDER = "What are you looking for?";

const STOCK_ACTIONS = [
  { id: "create-folder", title: "Create Folder", summary: "Organize pages into a named folder", route: null },
  { id: "create-report", title: "Create Report", summary: "Generate a report from brain content", route: null },
  { id: "cleanup", title: "Cleanup", summary: "Review stale pages, resolve flags, fix drift", route: "/cleanup" },
  { id: "settings", title: "Settings", summary: "Org, theme, API keys, content rules", route: "/settings" },
];

const FOLDER_ORDER = ["Pinned", "Quick Actions", "Skills", "Templates"];

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function PageIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

function ZapIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="5" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="19" r="1.5" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16h14v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6a1 1 0 0 1 1-1h.5a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-9a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5H8a1 1 0 0 1 1 1z" />
    </svg>
  );
}

export function ActionBarHome({ vocabulary, folders, pages, orgName, logoUrl, quickRefs = [] }: ActionBarHomeProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [semantic, setSemantic] = useState<SemanticResult | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  // While searching, folders auto-expand to show matches; this records the
  // user's manual toggles on top of that (name -> open). Reset per query.
  const [searchOverrides, setSearchOverrides] = useState<Map<string, boolean>>(new Map());
  const [ctxMenu, setCtxMenu] = useState<{ type: "folder" | "page" | "action"; name: string; anchorEl: HTMLElement | null }>({ type: "folder", name: "", anchorEl: null });
  const [reportOpen, setReportOpen] = useState(false);
  const [folderModal, setFolderModal] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderSubmitting, setFolderSubmitting] = useState(false);
  const [movePageSlug, setMovePageSlug] = useState<string | null>(null);
  const [visPageSlug, setVisPageSlug] = useState<string | null>(null);
  const [addPageFolderId, setAddPageFolderId] = useState<string | null>(null);
  const [addPagePreset, setAddPagePreset] = useState<string | null>(null);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [newPageOpen, setNewPageOpen] = useState(false);
  const [deletePageSlug, setDeletePageSlug] = useState<string | null>(null);
  const [deleteFolderId, setDeleteFolderId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [renameFolderId, setRenameFolderId] = useState<string | null>(null);
  const [renameFolderValue, setRenameFolderValue] = useState("");
  const [moveFolderId, setMoveFolderId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const folderMap = useMemo(() => {
    const m = new Map<string, ActionBarFolder>();
    for (const f of folders) m.set(f.id, f);
    return m;
  }, [folders]);

  const orgPinnedSlugs = useMemo(() => pages.filter((p) => p.pinned).map((p) => p.slug), [pages]);

  const pinnedSlugs = useMemo(() => {
    if (typeof window === "undefined") return orgPinnedSlugs;
    return readPinsSeeded(orgPinnedSlugs);
  }, [orgPinnedSlugs]);

  const isSearching = !!query.trim();

  // Nearest-first ancestor chain for a folder id (the folder itself included).
  const ancestorsOf = useCallback((folderId: string | null | undefined): ActionBarFolder[] => {
    const out: ActionBarFolder[] = [];
    let cur = folderId ? folderMap.get(folderId) : undefined;
    let guard = 0;
    while (cur && guard++ < 32) {
      out.push(cur);
      cur = cur.parentId ? folderMap.get(cur.parentId) : undefined;
    }
    return out;
  }, [folderMap]);

  const matchedConcept = useMemo(() => {
    if (!query.trim()) return null;
    const q = query.toLowerCase().trim().replace(/\s+/g, "-");
    return vocabulary.concepts.find((c) => c.term.toLowerCase() === q) ?? null;
  }, [query, vocabulary.concepts]);

  const filteredPages = useMemo(() => {
    if (!query.trim()) return pages;
    const q = query.toLowerCase().trim();
    // A page matches on its own title, or because it lives under a folder
    // whose name matches (searching "dtcc" surfaces everything in DTCC/).
    const hit = (p: ActionBarPage) =>
      p.title.toLowerCase().includes(q) || ancestorsOf(p.folderId).some((f) => f.name.toLowerCase().includes(q));
    if (semantic && semantic.pages.length > 0) {
      const semanticSlugs = new Set(semantic.pages.map((p) => p.slug));
      const conceptMap = new Map(semantic.pages.map((p) => [p.slug, p.sharedConcepts]));
      const semanticOnly = pages
        .filter((p) => semanticSlugs.has(p.slug) && !hit(p))
        .map((p) => ({ ...p, _concepts: conceptMap.get(p.slug) }));
      const titleMatchSemantic = pages
        .filter((p) => semanticSlugs.has(p.slug) && hit(p))
        .map((p) => ({ ...p, _concepts: conceptMap.get(p.slug) }));
      const titleMatchOther = pages
        .filter((p) => !semanticSlugs.has(p.slug) && hit(p));
      return [...titleMatchSemantic, ...titleMatchOther, ...semanticOnly];
    }
    return pages.filter(hit);
  }, [query, pages, semantic, ancestorsOf]);

  // While searching, only folders that match by name, or hold a matching page
  // somewhere below them (plus their ancestors so the path stays walkable),
  // are shown. null = not searching, show everything.
  const visibleFolderIds = useMemo(() => {
    if (!query.trim()) return null;
    const q = query.toLowerCase().trim();
    const ids = new Set<string>();
    const addChain = (id: string) => { for (const f of ancestorsOf(id)) ids.add(f.id); };
    for (const f of folders) if (f.name.toLowerCase().includes(q)) addChain(f.id);
    for (const p of filteredPages) if (p.folderId) addChain(p.folderId);
    return ids;
  }, [query, folders, filteredPages, ancestorsOf]);

  const searchSemantic = useCallback(async (term: string) => {
    if (!term.trim()) { setSemantic(null); return; }
    try {
      const res = await fetch(`${basePath}/api/ask?term=${encodeURIComponent(term.trim())}`);
      if (!res.ok) return;
      const data = (await res.json()) as SemanticResult;
      if (data.pages.length > 0) setSemantic(data);
      else setSemantic(null);
    } catch {
      // silent
    }
  }, []);

  function onQueryChange(value: string) {
    setQuery(value);
    setSemantic(null);
    setSearchOverrides(new Map());
    clearTimeout(debounceRef.current);
    if (value.trim()) {
      debounceRef.current = setTimeout(() => searchSemantic(value), 300);
    }
  }

  useEffect(() => {
    return () => clearTimeout(debounceRef.current);
  }, []);

  // While searching, auto-expand every visible folder (the full path down to
  // each match) so results are actually on screen. Past a broad-query cap the
  // tree stays collapsed and "expand all" / per-folder toggles take over.
  const AUTO_EXPAND_CAP = 40;
  const autoExpanded = useMemo(() => {
    if (!visibleFolderIds || filteredPages.length === 0) return null;
    const names = new Set<string>(["Pinned"]);
    if (filteredPages.length < AUTO_EXPAND_CAP) {
      for (const id of visibleFolderIds) {
        const f = folderMap.get(id);
        if (f) names.add(f.name);
      }
    }
    return names;
  }, [visibleFolderIds, filteredPages, folderMap]);

  const effectiveExpanded = useMemo(() => {
    if (!isSearching) return expandedFolders;
    const base = new Set(autoExpanded ?? []);
    for (const [name, open] of searchOverrides) {
      if (open) base.add(name);
      else base.delete(name);
    }
    return base;
  }, [isSearching, expandedFolders, autoExpanded, searchOverrides]);

  // Group pages by folder
  const { folderGroups, unfiled, pinnedPages } = useMemo(() => {
    const groups = new Map<string, { folder: ActionBarFolder; pages: typeof filteredPages }>();
    const unf: typeof filteredPages = [];
    const pinned: typeof filteredPages = [];
    const pinnedSet = new Set(pinnedSlugs);

    for (const p of filteredPages) {
      if (pinnedSet.has(p.slug)) pinned.push(p);
      if (p.folderId) {
        const f = folderMap.get(p.folderId);
        if (f) {
          if (!groups.has(f.name)) groups.set(f.name, { folder: f, pages: [] });
          groups.get(f.name)!.pages.push(p);
        } else {
          unf.push(p);
        }
      } else if (!pinnedSet.has(p.slug)) {
        unf.push(p);
      }
    }
    return { folderGroups: groups, unfiled: unf, pinnedPages: pinned };
  }, [filteredPages, folderMap, pinnedSlugs]);

  // Build ordered folder list. Quick Actions always present (has stock actions).
  const childFoldersByParent = useMemo(() => {
    const m = new Map<string, ActionBarFolder[]>();
    for (const f of folders) {
      if (f.parentId) {
        if (!m.has(f.parentId)) m.set(f.parentId, []);
        m.get(f.parentId)!.push(f);
      }
    }
    return m;
  }, [folders]);

  const orderedFolderNames = useMemo(() => {
    const ordered: string[] = [];
    const seen = new Set<string>();
    const rootFolders = folders.filter((f) => !f.parentId);
    for (const name of FOLDER_ORDER) {
      if (name === "Pinned" && pinnedPages.length > 0) { ordered.push("Pinned"); seen.add("Pinned"); }
      else if (name === "Quick Actions") { ordered.push("Quick Actions"); seen.add("Quick Actions"); }
      else if (name !== "Pinned" && (folderGroups.has(name) || rootFolders.some((f) => f.name === name))) {
        ordered.push(name); seen.add(name);
      }
    }
    for (const name of folderGroups.keys()) {
      const f = folders.find((fo) => fo.name === name);
      if (!seen.has(name) && (!f || !f.parentId)) { ordered.push(name); seen.add(name); }
    }
    for (const f of rootFolders) {
      if (!seen.has(f.name)) { ordered.push(f.name); seen.add(f.name); }
    }
    if (!visibleFolderIds) return ordered;
    // Searching: drop Quick Actions and any root folder with nothing to show.
    return ordered.filter((name) => {
      if (name === "Pinned") return true;
      if (name === "Quick Actions") return false;
      const f = rootFolders.find((fo) => fo.name === name);
      return !!f && visibleFolderIds.has(f.id);
    });
  }, [folderGroups, pinnedPages, folders, visibleFolderIds]);

  // Every folder name currently rendered (roots + visible descendants), so
  // expand/collapse-all reaches nested folders instead of just the top level.
  const renderedFolderNames = useMemo(() => {
    const names: string[] = [...orderedFolderNames];
    const walk = (parentId: string) => {
      for (const c of childFoldersByParent.get(parentId) ?? []) {
        if (visibleFolderIds && !visibleFolderIds.has(c.id)) continue;
        names.push(c.name);
        walk(c.id);
      }
    };
    for (const name of orderedFolderNames) {
      const f = folders.find((fo) => fo.name === name && !fo.parentId);
      if (f) walk(f.id);
    }
    return names;
  }, [orderedFolderNames, childFoldersByParent, folders, visibleFolderIds]);

  function renderSubfolders(parentId: string): React.ReactNode {
    const children = (childFoldersByParent.get(parentId) ?? [])
      .filter((c) => !visibleFolderIds || visibleFolderIds.has(c.id));
    if (children.length === 0) return null;
    return children.map((child) => {
      const childGroup = folderGroups.get(child.name);
      const childPages = childGroup?.pages ?? [];
      const childOpen = effectiveExpanded.has(child.name);
      return (
        <div key={child.id} className="abh-folder-group abh-subfolder">
          <div className="abh-folder-label" onClick={() => toggleFolder(child.name)}>
            <span className={`abh-chevron${childOpen ? "" : " abh-chevron--collapsed"}`}>&#9662;</span>
            <FolderIcon />
            <span className="abh-folder-name">{child.name}</span>
            <div className="abh-folder-actions">
              <button type="button" className="abh-action-btn" onClick={(e) => { e.stopPropagation(); copyFolder(child.name); }} title="Copy for agent">
                <CopyIcon />
              </button>
              {!child.locked && (
                <button type="button" className="abh-action-btn" onClick={(e) => showCtxMenu(e, "folder", child.name)} title="More actions">
                  <DotsIcon />
                </button>
              )}
            </div>
          </div>
          {childOpen && (
            <div className="abh-folder-pages">
              {renderSubfolders(child.id)}
              {childPages.map((p) => (
                <PageRow key={p.slug} page={p} onCopy={copyPage} onCtxMenu={showCtxMenu} inLockedFolder={!!child.locked} />
              ))}
            </div>
          )}
        </div>
      );
    });
  }

  function toggleFolder(name: string) {
    if (isSearching) {
      const open = effectiveExpanded.has(name);
      setSearchOverrides((prev) => new Map(prev).set(name, !open));
      return;
    }
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleAll() {
    const open = !allExpanded;
    if (isSearching) {
      setSearchOverrides(new Map(renderedFolderNames.map((n) => [n, open] as [string, boolean])));
      return;
    }
    setExpandedFolders(open ? new Set(renderedFolderNames) : new Set());
  }

  async function copyFolder(folderName: string) {
    const group = folderGroups.get(folderName);
    if (!group) return;
    const refs = group.pages.map((p) => ({ slug: p.slug, title: p.title }));
    const result = await copyPagesForAgent(folderName, refs);
    if (result === "ok") toast.success(`Copied ${refs.length} page${refs.length === 1 ? "" : "s"} for agent`);
    else toast.error("Copy failed");
  }

  async function copyPage(page: ActionBarPage) {
    const result = await copyPagesForAgent(page.title, [{ slug: page.slug, title: page.title }]);
    if (result === "ok") toast.success(`Copied "${page.title}" for agent`);
    else toast.error("Copy failed");
  }

  async function copyReferenceForAgent() {
    const baseUrl = `${window.location.origin}${basePath}`;
    const lines = filteredPages.map((p) => `- ${p.title} | ${baseUrl}/pages/${p.slug}`);
    const body = [
      `# Curata page reference (${filteredPages.length} pages)`,
      `Source: ${baseUrl}`,
      `MCP endpoint: ${baseUrl}/api/mcp`,
      "",
      ...lines,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(body);
      toast.success(`Copied reference for ${filteredPages.length} pages`);
    } catch {
      toast.error("Copy failed");
    }
  }

  function showCtxMenu(e: React.MouseEvent, type: "folder" | "page" | "action", name: string) {
    e.stopPropagation();
    setCtxMenu({ type, name, anchorEl: e.currentTarget as HTMLElement });
  }

  async function renameFolder(id: string, name: string) {
    const res = await fetch(`${basePath}/api/folders`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name }),
    });
    if (res.ok) {
      toast.success("Renamed");
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      toast.error(d.error || "Rename failed");
    }
    setRenameFolderId(null);
  }

  async function moveFolderTo(id: string, parentId: string | null) {
    const res = await fetch(`${basePath}/api/folders`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, parentId }),
    });
    if (res.ok) {
      toast.success("Moved");
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      toast.error(d.error || "Move failed");
    }
    setMoveFolderId(null);
  }

  async function movePageToFolder(slug: string, folderId: string | null) {
    const res = await fetch(`${basePath}/api/pages`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, folderId }),
    });
    if (res.ok) {
      toast.success("Moved");
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      toast.error(d.error || "Move failed");
    }
    setMovePageSlug(null);
  }

  async function setPageVisibility(slug: string, visibility: string) {
    const res = await fetch(`${basePath}/api/pages`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, visibility }),
    });
    if (res.ok) {
      toast.success(`Visibility set to ${visibility}`);
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      toast.error(d.error || "Update failed");
    }
    setVisPageSlug(null);
  }

  function getCtxMenuItems(): ContextMenuItem[] {
    if (ctxMenu.type === "folder") {
      const f = folders.find((fo) => fo.name === ctxMenu.name);
      const items: ContextMenuItem[] = [];
      if (f) {
        if (f.name === "Quick Actions") {
          items.push({ label: "Add action", onClick: () => { setSkillPickerOpen(true); } });
        } else {
          items.push({ label: "Add page", onClick: () => {
            setAddPageFolderId(f.id);
            setAddPagePreset(f.name === "Skills" ? "skill" : null);
          } });
        }
      }
      items.push({ label: "Copy for agent", onClick: () => { copyFolder(ctxMenu.name); } });
      if (f && !f.locked) {
        items.push({ label: "", divider: true, onClick: () => {} });
        items.push({ label: "Rename", onClick: () => { setRenameFolderId(f.id); setRenameFolderValue(f.name); } });
        items.push({ label: "Move", onClick: () => { setMoveFolderId(f.id); } });
        items.push({ label: "Delete", danger: true, onClick: () => { setDeleteFolderId(f.id); } });
      }
      return items;
    }
    if (ctxMenu.type === "action") {
      return [
        { label: "Copy link", onClick: () => {
          navigator.clipboard.writeText(`${window.location.origin}${basePath}/pages/${ctxMenu.name}`).catch(() => {});
          toast.success("Link copied");
        }},
        { label: "Remove action", onClick: () => { removeQuickAction(ctxMenu.name); } },
      ];
    }
    // page
    return [
      { label: "Copy link", onClick: () => {
        navigator.clipboard.writeText(`${window.location.origin}${basePath}/pages/${ctxMenu.name}`).catch(() => {});
        toast.success("Link copied");
      }},
      { label: "Move to folder", onClick: () => { setMovePageSlug(ctxMenu.name); } },
      { label: "", divider: true, onClick: () => {} },
      { label: "Set visibility", onClick: () => { setVisPageSlug(ctxMenu.name); } },
      { label: "Delete page", danger: true, onClick: () => { setDeletePageSlug(ctxMenu.name); } },
    ];
  }

  const contentCount = filteredPages.length;
  const allExpanded = renderedFolderNames.length > 0 && renderedFolderNames.every((n) => effectiveExpanded.has(n));

  async function createFolder() {
    if (!folderName.trim()) return;
    setFolderSubmitting(true);
    try {
      const r = await fetch(`${basePath}/api/folders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: folderName.trim() }),
      });
      if (r.ok) {
        toast.success(`Created folder "${folderName.trim()}"`);
        setFolderModal(false);
        setFolderName("");
        router.refresh();
      } else {
        toast.error("Failed to create folder");
      }
    } catch {
      toast.error("Failed to create folder");
    }
    setFolderSubmitting(false);
  }

  function handleStockAction(action: typeof STOCK_ACTIONS[0]) {
    if (action.id === "create-folder") {
      setFolderName("");
      setFolderModal(true);
    } else if (action.id === "create-report") {
      setReportOpen(true);
    } else if (action.route) {
      router.push(action.route);
    }
  }

  // Custom quick actions: refs to pages living in the Skills folder.
  const skillsFolder = useMemo(() => folders.find((f) => f.name === "Skills"), [folders]);
  const skillsPages = useMemo(
    () => (skillsFolder ? pages.filter((p) => p.folderId === skillsFolder.id) : []),
    [pages, skillsFolder]
  );
  const refPages = useMemo(() => {
    const bySlug = new Map(pages.map((p) => [p.slug, p]));
    return quickRefs.map((slug) => bySlug.get(slug)).filter((p): p is ActionBarPage => !!p);
  }, [quickRefs, pages]);

  // Same actions as the Quick Actions section, as a floating dock (matches
  // the page view). Stock actions are individual buttons; custom skill
  // actions live behind one "Skills" button that opens a list.
  // Built-in skill: an auto-generated brief listing pages updated in the last
  // few days (title, URL, when), with the MCP pointer so an agent can read them.
  const RECENT_DAYS = 3;
  const RECENT_ACTION = { title: "What happened recently", summary: `Pages updated in the last ${RECENT_DAYS} days, as an agent brief` };
  const copyRecent = useCallback(() => {
    const cutoff = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000;
    const sorted = [...pages]
      .filter((p) => p.updatedAt)
      .sort((a, b) => (b.updatedAt! > a.updatedAt! ? 1 : b.updatedAt! < a.updatedAt! ? -1 : 0));
    let recent = sorted.filter((p) => new Date(p.updatedAt!).getTime() >= cutoff);
    let label = `${RECENT_ACTION.title} (last ${RECENT_DAYS} days)`;
    if (recent.length === 0) { recent = sorted.slice(0, 10); label = `${RECENT_ACTION.title} (nothing in ${RECENT_DAYS} days, 10 most recent)`; }
    if (recent.length === 0) { toast.error("No pages yet"); return; }
    const refs = recent.map((p) => ({ slug: p.slug, title: p.title, meta: `updated ${p.updatedAt!.slice(0, 10)}` }));
    copyRefsForAgent(label, refs).then((result) => {
      if (result === "ok") toast.success(`Copied brief: ${recent.length} page${recent.length === 1 ? "" : "s"} updated recently`);
      else toast.error("Couldn't copy — check your connection and try again");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages]);

  const homeActions = useMemo<PageAction[]>(() => {
    const icons: Record<string, PageAction["icon"]> = {
      "create-folder": "folder",
      "create-report": "report",
      cleanup: "broom",
      settings: "settings",
    };
    return [
      { id: "new-page", label: "New page", hint: "Start from a template or scratch", icon: "plus" as const, run: () => setNewPageOpen(true) },
      ...STOCK_ACTIONS.map((a) => ({
        id: a.id,
        label: a.title,
        hint: a.summary,
        icon: icons[a.id],
        run: () => handleStockAction(a),
      })),
      {
        id: "skills",
        label: "Skills",
        icon: "zap" as const,
        run: () => {},
        children: [
          { id: "skill-recent", label: RECENT_ACTION.title, hint: "copy for agent", icon: "clock" as const, run: copyRecent },
          ...refPages.map((p) => ({
            id: `skill-${p.slug}`,
            label: p.title,
            hint: "copy for agent",
            icon: "zap" as const,
            run: () => {
              copyPagesForAgent(p.title, [{ slug: p.slug, title: p.title }]).then((result) => {
                if (result === "ok") toast.success(`Copied "${p.title}" for an agent`);
                else toast.error("Couldn't copy — check your connection and try again");
              });
            },
          })),
          { id: "add-action", label: "Add action", icon: "plus" as const, run: () => setSkillPickerOpen(true) },
        ],
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refPages, copyRecent]);

  async function addQuickAction(slug: string) {
    const res = await fetch(`${basePath}/api/quick-actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug }),
    });
    if (res.ok) {
      toast.success("Quick action added");
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      toast.error(d.error || "Failed to add quick action");
    }
    setSkillPickerOpen(false);
  }

  // Deleting a folder cascades: subfolders and every page inside go with it
  // (matches the /api/folders DELETE behavior). Used by the confirm modal to
  // show exactly what the cascade takes out.
  function descendantPagesOf(folderId: string) {
    const ids = new Set<string>([folderId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of folders) {
        if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) {
          ids.add(f.id);
          grew = true;
        }
      }
    }
    return pages.filter((p) => p.folderId && ids.has(p.folderId));
  }

  async function deletePage(slug: string) {
    setDeleteBusy(true);
    try {
      const res = await fetch(`${basePath}/api/pages?slug=${encodeURIComponent(slug)}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Page deleted");
      } else {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error || "Failed to delete page");
      }
    } catch {
      toast.error("Failed to delete page — check your connection");
    } finally {
      setDeleteBusy(false);
      setDeletePageSlug(null);
      router.refresh();
    }
  }

  async function deleteFolder(id: string) {
    setDeleteBusy(true);
    try {
      const res = await fetch(`${basePath}/api/folders`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        toast.success("Folder deleted");
      } else {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error || "Failed to delete folder");
      }
    } catch {
      toast.error("Failed to delete folder — check your connection");
    } finally {
      setDeleteBusy(false);
      setDeleteFolderId(null);
      router.refresh();
    }
  }

  async function removeQuickAction(slug: string) {
    const res = await fetch(`${basePath}/api/quick-actions`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug }),
    });
    if (res.ok) {
      toast.success("Quick action removed");
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      toast.error(d.error || "Failed to remove quick action");
    }
  }

  return (
    <div className="abh-root">
      <PageActionDock actions={homeActions} hidden={folderModal || reportOpen || skillPickerOpen || newPageOpen} />
      {newPageOpen && <NewPageButton key="dock-new-page" defaultOpen onClose={() => setNewPageOpen(false)} />}
      <div className="abh-brand">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={orgName} className="abh-brand-logo" />
        ) : (
          <svg className="abh-brand-mark" viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <path d="M 24.43 8.93 A 11 11 0 1 0 24.43 23.07" stroke="rgb(var(--accent-rgb))" strokeWidth="3.5" strokeLinecap="round" />
            <circle cx="27.2" cy="16" r="3.4" fill="rgba(var(--accent-rgb), 0.5)" />
          </svg>
        )}
        <span className="abh-brand-name">{orgName}</span>
      </div>

      <div className="abh-search">
        <SearchIcon />
        <input
          ref={inputRef}
          type="text"
          className="abh-search-input"
          placeholder={query ? "" : SEARCH_PLACEHOLDER}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          autoFocus
        />
        {query && (
          <button
            type="button"
            className="abh-search-clear"
            onClick={() => { setQuery(""); setSemantic(null); inputRef.current?.focus(); }}
          >
            &#10005;
          </button>
        )}
        <kbd className="abh-search-kbd">{"⌘"}K</kbd>
      </div>

      {matchedConcept && (
        <div className="abh-concept-badge">
          <span className={`abh-kind-dot abh-kind-dot--${kindSlug(matchedConcept.kind)}`} />
          <span className="abh-concept-term">{matchedConcept.term}</span>
          <span className="abh-concept-kind">{matchedConcept.kind}</span>
        </div>
      )}

      <div className="abh-dir-head">
        <span className="abh-dir-count">
          {contentCount} page{contentCount === 1 ? "" : "s"}
        </span>
        {orderedFolderNames.length > 0 && (
          <button type="button" className="abh-toggle-all" onClick={toggleAll}>
            {allExpanded ? "collapse all" : "expand all"}
          </button>
        )}
        <span style={{ flex: 1 }} />
        {isSearching && contentCount > 0 && (
          <button type="button" className="abh-copy-ref" onClick={copyReferenceForAgent}>
            Copy reference for agent
          </button>
        )}
      </div>

      <div className="abh-directory">
        {orderedFolderNames.map((name) => {
          if (name === "Pinned") {
            const isOpen = effectiveExpanded.has("Pinned");
            return (
              <div key="Pinned" className="abh-folder-group">
                <div className="abh-folder-label" onClick={() => toggleFolder("Pinned")}>
                  <span className={`abh-chevron${isOpen ? "" : " abh-chevron--collapsed"}`}>&#9662;</span>
                  <PinIcon />
                  <span className="abh-folder-name">Pinned</span>
                  <div className="abh-folder-actions">
                    <button type="button" className="abh-action-btn" onClick={(e) => { e.stopPropagation(); copyFolder("Pinned"); }} title="Copy for agent">
                      <CopyIcon />
                    </button>
                  </div>
                </div>
                {isOpen && (
                  <div className="abh-folder-pages">
                    {pinnedPages.map((p) => (
                      <PageRow key={p.slug} page={p} onCopy={copyPage} onCtxMenu={showCtxMenu} inLockedFolder={false} />
                    ))}
                  </div>
                )}
              </div>
            );
          }

          const group = folderGroups.get(name);
          const isQA = name === "Quick Actions";
          const folderEntry = folders.find((f) => f.name === name);
          if (!group && !isQA && !folderEntry) return null;
          const isOpen = effectiveExpanded.has(name);
          const isLocked = group?.folder.locked ?? folderEntry?.locked ?? false;
          const groupPages = group?.pages ?? [];

          return (
            <div key={name} className="abh-folder-group">
              <div className="abh-folder-label" onClick={() => toggleFolder(name)}>
                <span className={`abh-chevron${isOpen ? "" : " abh-chevron--collapsed"}`}>&#9662;</span>
                {isQA ? <ZapIcon /> : <FolderIcon />}
                <span className="abh-folder-name">{name}</span>
                <div className="abh-folder-actions">
                  <button type="button" className="abh-action-btn" onClick={(e) => {
                    e.stopPropagation();
                    if (isQA) {
                      const stock = STOCK_ACTIONS.map((a) => `- ${a.title}: ${a.summary}`);
                      const refs = [`- ${RECENT_ACTION.title}: ${RECENT_ACTION.summary}`, ...refPages.map((p) => `- ${p.title} (skill page: ${p.slug})`)];
                      navigator.clipboard.writeText(`Quick Actions:\n${[...stock, ...refs].join("\n")}`).catch(() => {});
                      toast.success("Copied quick actions for agent");
                    } else {
                      copyFolder(name);
                    }
                  }} title="Copy for agent">
                    <CopyIcon />
                  </button>
                  <button type="button" className="abh-action-btn" onClick={(e) => showCtxMenu(e, "folder", name)} title="More actions">
                    <DotsIcon />
                  </button>
                </div>
              </div>
              {isOpen && (
                <div className="abh-folder-pages">
                  {isQA && (
                    <>
                      {STOCK_ACTIONS.map((a) => (
                        <div key={a.id} className="abh-page-row abh-qa-row" onClick={() => handleStockAction(a)}>
                          <ZapIcon />
                          <span className="abh-page-title">{a.title}</span>
                          <span className="abh-qa-summary">{a.summary}</span>
                        </div>
                      ))}
                      <div className="abh-page-row abh-qa-row" onClick={copyRecent}>
                        <ZapIcon />
                        <span className="abh-page-title">{RECENT_ACTION.title}</span>
                        <span className="abh-qa-summary">{RECENT_ACTION.summary}</span>
                      </div>
                      {refPages.map((p) => (
                        <PageRow
                          key={p.slug}
                          page={p}
                          onCopy={copyPage}
                          onCtxMenu={showCtxMenu}
                          inLockedFolder={false}
                          isAction
                        />
                      ))}
                    </>
                  )}
                  {folderEntry && renderSubfolders(folderEntry.id)}
                  {groupPages.map((p) => (
                    <PageRow
                      key={p.slug}
                      page={p}
                      onCopy={copyPage}
                      onCtxMenu={showCtxMenu}
                      inLockedFolder={!!isLocked}
                      isAction={isQA}
                    />
                  ))}
                  {isQA && (
                    <div className="abh-add-action-row" onClick={() => setSkillPickerOpen(true)}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                      Add action
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {unfiled.length > 0 && (
          <>
            <div className="abh-unfiled-label">Unfiled</div>
            {unfiled.map((p) => (
              <PageRow key={p.slug} page={p} onCopy={copyPage} onCtxMenu={showCtxMenu} inLockedFolder={false} />
            ))}
          </>
        )}
      </div>

      {filteredPages.length === 0 && query && (
        <div className="abh-no-results">
          <p>No pages match &ldquo;{query}&rdquo;.</p>
          <NewPageButton className="btn btn--primary" label="Create a new page" />
        </div>
      )}

      <ContextMenu
        items={getCtxMenuItems()}
        anchorEl={ctxMenu.anchorEl}
        open={!!ctxMenu.anchorEl}
        onClose={() => setCtxMenu({ ...ctxMenu, anchorEl: null })}
      />

      {reportOpen && (
        <ReportBuilder
          onClose={() => setReportOpen(false)}
          allPages={pages.map((p) => ({ slug: p.slug, title: p.title }))}
        />
      )}

      {folderModal && (
        <div className="abh-modal-overlay" onClick={() => setFolderModal(false)}>
          <div className="abh-modal" onClick={(e) => e.stopPropagation()}>
            <div className="abh-modal-title">Create folder</div>
            <input
              type="text"
              className="abh-modal-input"
              placeholder="Folder name"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") createFolder(); }}
              autoFocus
            />
            <div className="abh-modal-actions">
              <button type="button" className="btn btn--ghost" onClick={() => setFolderModal(false)}>Cancel</button>
              <button type="button" className="btn btn--primary" disabled={!folderName.trim() || folderSubmitting} onClick={createFolder}>
                {folderSubmitting ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {movePageSlug && (
        <div className="abh-modal-overlay" onClick={() => setMovePageSlug(null)}>
          <div className="abh-modal" onClick={(e) => e.stopPropagation()}>
            <div className="abh-modal-title">Move to folder</div>
            <div className="abh-picker-list">
              <button
                type="button"
                className="abh-picker-item"
                onClick={() => movePageToFolder(movePageSlug, null)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="1" /><path d="M17 12H7" /></svg>
                No folder
              </button>
              {folders.filter((f) => !f.locked).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className="abh-picker-item"
                  onClick={() => movePageToFolder(movePageSlug, f.id)}
                >
                  <FolderIcon />
                  {f.name}
                </button>
              ))}
            </div>
            <div className="abh-modal-actions">
              <button type="button" className="btn btn--ghost" onClick={() => setMovePageSlug(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {addPageFolderId && (
        <NewPageButton
          key={addPageFolderId}
          folderId={addPageFolderId}
          presetTemplate={addPagePreset}
          defaultOpen
          onClose={() => { setAddPageFolderId(null); setAddPagePreset(null); }}
        />
      )}

      {skillPickerOpen && (
        <div className="abh-modal-overlay" onClick={() => setSkillPickerOpen(false)}>
          <div className="abh-modal" onClick={(e) => e.stopPropagation()}>
            <div className="abh-modal-title">Add action</div>
            <div className="abh-modal-desc">Quick actions point at a page in the Skills folder.</div>
            <div className="abh-picker-list">
              {skillsPages.filter((p) => !quickRefs.includes(p.slug)).map((p) => (
                <button
                  key={p.slug}
                  type="button"
                  className="abh-picker-item"
                  onClick={() => addQuickAction(p.slug)}
                >
                  <ZapIcon />
                  {p.title}
                </button>
              ))}
              {skillsPages.filter((p) => !quickRefs.includes(p.slug)).length === 0 && (
                <div className="abh-picker-empty">
                  {skillsPages.length === 0
                    ? "No pages in the Skills folder yet. Add a skill first."
                    : "Every skill already has a quick action."}
                </div>
              )}
            </div>
            <div className="abh-modal-actions">
              <button type="button" className="btn btn--ghost" onClick={() => setSkillPickerOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {renameFolderId && (
        <div className="abh-modal-overlay" onClick={() => setRenameFolderId(null)}>
          <div className="abh-modal" onClick={(e) => e.stopPropagation()}>
            <div className="abh-modal-title">Rename folder</div>
            <input
              type="text"
              className="abh-modal-input"
              value={renameFolderValue}
              onChange={(e) => setRenameFolderValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && renameFolderValue.trim()) renameFolder(renameFolderId, renameFolderValue.trim()); }}
              autoFocus
            />
            <div className="abh-modal-actions">
              <button type="button" className="btn btn--ghost" onClick={() => setRenameFolderId(null)}>Cancel</button>
              <button type="button" className="btn btn--primary" disabled={!renameFolderValue.trim()} onClick={() => renameFolder(renameFolderId, renameFolderValue.trim())}>
                Rename
              </button>
            </div>
          </div>
        </div>
      )}

      {moveFolderId && (
        <div className="abh-modal-overlay" onClick={() => setMoveFolderId(null)}>
          <div className="abh-modal" onClick={(e) => e.stopPropagation()}>
            <div className="abh-modal-title">Move folder to</div>
            <div className="abh-picker-list">
              <button
                type="button"
                className="abh-picker-item"
                onClick={() => moveFolderTo(moveFolderId, null)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
                Top level
              </button>
              {folders.filter((f) => f.id !== moveFolderId && !f.locked).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className="abh-picker-item"
                  onClick={() => moveFolderTo(moveFolderId, f.id)}
                >
                  <FolderIcon />
                  {f.name}
                </button>
              ))}
            </div>
            <div className="abh-modal-actions">
              <button type="button" className="btn btn--ghost" onClick={() => setMoveFolderId(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {visPageSlug && (
        <div className="abh-modal-overlay" onClick={() => setVisPageSlug(null)}>
          <div className="abh-modal" onClick={(e) => e.stopPropagation()}>
            <div className="abh-modal-title">Set visibility</div>
            <div className="abh-picker-list">
              {["private", "org", "public"].map((v) => (
                <button
                  key={v}
                  type="button"
                  className="abh-picker-item"
                  onClick={() => setPageVisibility(visPageSlug, v)}
                >
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
            <div className="abh-modal-actions">
              <button type="button" className="btn btn--ghost" onClick={() => setVisPageSlug(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {deletePageSlug && (
        <ConfirmDeleteModal
          title={<>Delete &ldquo;{pages.find((p) => p.slug === deletePageSlug)?.title ?? deletePageSlug}&rdquo;?</>}
          confirmButtonLabel="Delete page"
          busyLabel="Deleting…"
          busy={deleteBusy}
          onCancel={() => setDeletePageSlug(null)}
          onConfirm={() => deletePage(deletePageSlug)}
        >
          <p className="confirm-delete-warning">This cannot be undone.</p>
        </ConfirmDeleteModal>
      )}

      {deleteFolderId && (() => {
        const f = folders.find((fo) => fo.id === deleteFolderId);
        if (!f) return null;
        const descendants = descendantPagesOf(f.id);
        return (
          <ConfirmDeleteModal
            title={<>Delete folder &ldquo;{f.name}&rdquo;?</>}
            confirmValue={f.name}
            confirmPrompt={<>Type <strong>{f.name}</strong> to confirm</>}
            confirmButtonLabel="Delete folder"
            busyLabel="Deleting…"
            busy={deleteBusy}
            onCancel={() => setDeleteFolderId(null)}
            onConfirm={() => deleteFolder(f.id)}
          >
            {descendants.length > 0 ? (
              <>
                <p className="confirm-delete-warning">
                  This also deletes {descendants.length} page{descendants.length !== 1 ? "s" : ""} inside
                  this folder and its subfolders. This cannot be undone.
                </p>
                <ul className="confirm-delete-list">
                  {descendants.slice(0, 5).map((p) => (
                    <li key={p.slug}>{p.title}</li>
                  ))}
                  {descendants.length > 5 && (
                    <li className="confirm-delete-more">+{descendants.length - 5} more</li>
                  )}
                </ul>
              </>
            ) : (
              <p className="confirm-delete-warning">This folder is empty. Deleting it cannot be undone.</p>
            )}
          </ConfirmDeleteModal>
        );
      })()}
    </div>
  );
}

function PageRow({
  page,
  onCopy,
  onCtxMenu,
  inLockedFolder,
  isAction,
}: {
  page: ActionBarPage & { _concepts?: string[] };
  onCopy: (p: ActionBarPage) => void;
  onCtxMenu: (e: React.MouseEvent, type: "folder" | "page" | "action", name: string) => void;
  inLockedFolder: boolean;
  isAction?: boolean;
}) {
  return (
    <Link href={`/pages/${page.slug}`} className="abh-page-row">
      {isAction ? <ZapIcon /> : <PageIcon />}
      <span className="abh-page-title">{page.title}</span>
      {page._concepts && page._concepts.length > 0 && (
        <span className="abh-page-concept">{page._concepts.join(", ")}</span>
      )}
      <div className="abh-page-hover-actions">
        <button type="button" className="abh-action-btn" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onCopy(page); }} title="Copy for agent">
          <CopyIcon />
        </button>
        {!inLockedFolder && (
          <button type="button" className="abh-action-btn" onClick={(e) => { e.preventDefault(); onCtxMenu(e, isAction ? "action" : "page", page.slug); }} title="More actions">
            <DotsIcon />
          </button>
        )}
      </div>
    </Link>
  );
}
