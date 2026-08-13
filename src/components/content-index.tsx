"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { GraphTag, GraphPage, GraphEdge } from "@/lib/graph";
import { kindSlug } from "@/lib/concept-kinds";
import { copyPagesForAgent } from "@/lib/copy-for-agent";
import { toast } from "@/components/toast";

interface ViewProps {
  tags: GraphTag[];
  pages: GraphPage[];
  edges: GraphEdge[];
  untaggedCount: number;
  untaggedPanel?: ReactNode;
}

type Kind = "vendor" | "finding" | "framework" | "topic" | "folder";

const KIND_ORDER: Kind[] = ["vendor", "finding", "framework", "topic", "folder"];
const KIND_LABEL: Record<Kind, string> = {
  vendor: "Vendor",
  finding: "Finding",
  framework: "Framework",
  topic: "Topic",
  folder: "Folder",
};

const UNTAGGED_ID = "__untagged";

function tagKind(t: GraphTag): Kind {
  return t.folderOnly ? "folder" : kindSlug(t.conceptKind);
}

function groupTags(tags: GraphTag[]) {
  const groups: Record<Kind, GraphTag[]> = { vendor: [], finding: [], framework: [], topic: [], folder: [] };
  for (const t of tags) groups[tagKind(t)].push(t);
  for (const k of KIND_ORDER) groups[k].sort((a, b) => b.pages - a.pages);
  return groups;
}

function usePagesByTag(pages: GraphPage[], edges: GraphEdge[]) {
  return useMemo(() => {
    const byId = new Map(pages.map((p) => [p.id, p]));
    const map = new Map<string, GraphPage[]>();
    for (const e of edges) {
      const page = byId.get(e.pageId);
      if (!page) continue;
      const list = map.get(e.tagId) ?? [];
      list.push(page);
      map.set(e.tagId, list);
    }
    return map;
  }, [pages, edges]);
}

function kindDotStyle(kind: Kind): React.CSSProperties {
  return kind === "folder"
    ? { background: "rgba(var(--text-rgb), 0.45)" }
    : { background: `rgba(var(--kind-${kind}-rgb), 0.95)` };
}

function FocusPanel({
  focusTag,
  tags,
  pagesByTag,
  untaggedPanel,
  onClose,
}: {
  focusTag: string | null;
  tags: GraphTag[];
  pagesByTag: Map<string, GraphPage[]>;
  untaggedPanel?: ReactNode;
  onClose: () => void;
}) {
  if (!focusTag) return null;

  if (focusTag === UNTAGGED_ID) {
    if (!untaggedPanel) return null;
    return (
      <aside className="kg-side">
        <div className="kg-side-head">
          <strong>untagged</strong>
          <button className="kg-side-close" onClick={onClose}>
            ✕
          </button>
        </div>
        {untaggedPanel}
      </aside>
    );
  }

  const tag = tags.find((t) => t.id === focusTag);
  if (!tag) return null;
  const tagPages = (pagesByTag.get(focusTag) ?? []).slice().sort((a, b) => a.title.localeCompare(b.title));

  async function copyAll() {
    const result = await copyPagesForAgent(
      tag!.name,
      tagPages.map((p) => ({ slug: p.slug, title: p.title })),
    );
    if (result === "ok") toast.success(`Copied ${tagPages.length} page${tagPages.length === 1 ? "" : "s"} for an agent`);
    else if (result === "empty") toast.info("Nothing to copy yet");
    else toast.error("Couldn't copy — check your connection and try again");
  }

  async function copyOne(p: GraphPage) {
    const result = await copyPagesForAgent(p.title, [{ slug: p.slug, title: p.title }]);
    if (result === "ok") toast.success(`Copied "${p.title}" for an agent`);
    else toast.error("Couldn't copy — check your connection and try again");
  }

  return (
    <aside className="kg-side">
      <div className="kg-side-head">
        <strong>{tag.name}</strong>
        <button className="kg-side-close" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="kg-focus-head">
        <span>
          {tagPages.length} pages · ~{tag.tokens} tokens to pull all
        </span>
        {tagPages.length > 0 && (
          <button type="button" className="ci-copy-all" onClick={copyAll}>
            Copy all for agent
          </button>
        )}
      </div>
      <ul className="activity-list">
        {tagPages.map((p) => (
          <li key={p.id} className="activity-row">
            <span className="activity-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6" />
              </svg>
            </span>
            <span className="activity-content">
              <span className="activity-body">
                <a href={`/pages/${p.slug}`} className="activity-link">
                  {p.title}
                </a>
              </span>
            </span>
            <button
              type="button"
              className="ci-copy-one"
              onClick={() => copyOne(p)}
              aria-label={`Copy "${p.title}" for an agent`}
              title="Copy for agent"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="12" height="12" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function KindLegend({ untaggedCount }: { untaggedCount: number }) {
  return (
    <div className="kg-legend">
      {KIND_ORDER.map((k) => (
        <span key={k}>
          <i className="kg-dot" style={kindDotStyle(k)} />
          {KIND_LABEL[k]}
        </span>
      ))}
      {untaggedCount > 0 && (
        <span>
          <i className="kg-dot" style={{ background: "rgba(var(--text-rgb), 0.14)", border: "1.5px dashed var(--light-muted)" }} />
          Untagged
        </span>
      )}
    </div>
  );
}

/** Section index: a browsable directory, grouped by kind, sorted by pages within each group. */
export function IndexView({ tags, pages, edges, untaggedCount, untaggedPanel }: ViewProps) {
  const [focusTag, setFocusTag] = useState<string | null>(null);
  const pagesByTag = usePagesByTag(pages, edges);
  const groups = useMemo(() => groupTags(tags), [tags]);

  const maxPages = Math.max(1, ...tags.map((t) => t.pages));
  const chipSize = (p: number) => 0.78 + (Math.sqrt(p) / Math.sqrt(maxPages)) * 0.14;

  if (tags.length === 0 && untaggedCount === 0) {
    return (
      <div className="kg-empty">
        Nothing tagged yet. Tag pages with concepts and they appear here as the org&apos;s
        knowledge graph.
      </div>
    );
  }

  return (
    <div className="ci-panel">
      <div className="ci-panel-main">
        <div className="ci-scroll ci-scroll-auto">
          {untaggedCount > 0 && (
            <button
              type="button"
              className="ci-untagged-card"
              onClick={() => setFocusTag(UNTAGGED_ID)}
            >
              <span className="ci-untagged-msg">
                <b>{untaggedCount}</b> page{untaggedCount === 1 ? "" : "s"} have no tag or folder yet
              </span>
              <span className="ci-untagged-cta">Review untagged →</span>
            </button>
          )}
          {KIND_ORDER.filter((k) => groups[k].length > 0).map((k) => {
            const items = groups[k];
            const total = items.reduce((s, t) => s + t.pages, 0);
            return (
              <div className="ci-sec" key={k}>
                <div className="ci-sec-head">
                  <i className="ci-dot" style={kindDotStyle(k)} />
                  <span className="ci-sec-name">{KIND_LABEL[k]}</span>
                  <span className="ci-sec-meta">
                    {items.length} tag{items.length === 1 ? "" : "s"} · {total} pages
                  </span>
                </div>
                <div className="ci-chip-grid">
                  {items.map((t) => (
                    <button
                      type="button"
                      key={t.id}
                      className="ci-chip"
                      style={{ fontSize: `${chipSize(t.pages)}rem` }}
                      onClick={() => setFocusTag(focusTag === t.id ? null : t.id)}
                    >
                      <i className="ci-chip-dot" style={kindDotStyle(k)} />
                      {t.name}
                      <span className="ci-chip-cnt">{t.pages}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <FocusPanel
          focusTag={focusTag}
          tags={tags}
          pagesByTag={pagesByTag}
          untaggedPanel={untaggedPanel}
          onClose={() => setFocusTag(null)}
        />
      </div>
      <KindLegend untaggedCount={untaggedCount} />
    </div>
  );
}

/** Scale view: marimekko-style proportional columns — column width = kind total, segment height = tag's pages. */
export function ScaleView({ tags, pages, edges, untaggedCount, untaggedPanel }: ViewProps) {
  const [focusTag, setFocusTag] = useState<string | null>(null);
  const [hover, setHover] = useState<{ label: string; pages: number; x: number; y: number } | null>(null);
  const pagesByTag = usePagesByTag(pages, edges);
  const groups = useMemo(() => groupTags(tags), [tags]);

  if (tags.length === 0 && untaggedCount === 0) {
    return (
      <div className="kg-empty">
        Nothing tagged yet. Tag pages with concepts and they appear here as the org&apos;s
        knowledge graph.
      </div>
    );
  }

  const nonEmptyKinds = KIND_ORDER.filter((k) => groups[k].length > 0);
  const kindTotals = nonEmptyKinds.map((k) => groups[k].reduce((s, t) => s + t.pages, 0));
  const grandTotal = kindTotals.reduce((a, b) => a + b, 0) + untaggedCount;

  return (
    <div className="kg-wrap">
      <div className="kg-main">
        <div className="ci-mek">
          {nonEmptyKinds.map((k, i) => {
            const total = kindTotals[i];
            const colFlex = grandTotal > 0 ? total / grandTotal : 1;
            return (
              <div className="ci-mek-col" key={k} style={{ flexGrow: colFlex, flexBasis: 0 }}>
                <div className="ci-mek-col-head">{KIND_LABEL[k]}</div>
                <div className="ci-mek-stack">
                  {groups[k].map((t) => {
                    const segFlex = total > 0 ? t.pages / total : 1;
                    const showLabel = segFlex > 0.09;
                    return (
                      <div
                        key={t.id}
                        className="ci-mek-seg"
                        style={{ flexGrow: segFlex, flexBasis: 0, ...kindDotStyle(k) }}
                        onClick={() => setFocusTag(focusTag === t.id ? null : t.id)}
                        onPointerEnter={(e) => setHover({ label: t.name, pages: t.pages, x: e.clientX, y: e.clientY })}
                        onPointerMove={(e) => setHover((h) => (h ? { ...h, x: e.clientX, y: e.clientY } : h))}
                        onPointerLeave={() => setHover(null)}
                      >
                        {showLabel && (
                          <span className="ci-mek-lbl">
                            {t.name}
                            <span className="ci-mek-n">{t.pages}</span>
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {untaggedCount > 0 && (
            <div
              className="ci-mek-col"
              style={{ flexGrow: grandTotal > 0 ? untaggedCount / grandTotal : 1, flexBasis: 0 }}
            >
              <div className="ci-mek-col-head">Untagged</div>
              <div className="ci-mek-stack">
                <div
                  className="ci-mek-seg ci-mek-seg-untagged"
                  onClick={() => setFocusTag(UNTAGGED_ID)}
                  onPointerEnter={(e) => setHover({ label: "untagged", pages: untaggedCount, x: e.clientX, y: e.clientY })}
                  onPointerMove={(e) => setHover((h) => (h ? { ...h, x: e.clientX, y: e.clientY } : h))}
                  onPointerLeave={() => setHover(null)}
                >
                  <span className="ci-mek-lbl">
                    untagged
                    <span className="ci-mek-n">{untaggedCount}</span>
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
        <FocusPanel
          focusTag={focusTag}
          tags={tags}
          pagesByTag={pagesByTag}
          untaggedPanel={untaggedPanel}
          onClose={() => setFocusTag(null)}
        />
      </div>
      <KindLegend untaggedCount={untaggedCount} />
      {hover && (
        <div className="kg-tooltip" style={{ left: hover.x + 12, top: hover.y + 12 }}>
          <strong>{hover.label}</strong>
          <div>{hover.pages} pages</div>
        </div>
      )}
    </div>
  );
}
