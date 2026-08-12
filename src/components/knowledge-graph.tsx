"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  forceSimulation,
  forceX,
  forceY,
  forceCollide,
  type SimulationNodeDatum,
} from "d3-force";
import type { GraphTag, GraphPage, GraphEdge, TagTier } from "@/lib/graph";

interface SimNode extends SimulationNodeDatum {
  id: string;
  kind: "tag" | "page" | "untagged";
  tier?: TagTier;
  label: string;
  r: number;
  slug?: string;
  pages?: number;
  tokens?: number;
}

interface Props {
  tags: GraphTag[];
  pages: GraphPage[];
  edges: GraphEdge[];
  untaggedCount: number;
  untaggedPanel?: ReactNode;
}

// Fallback used only until the wrap's real box is measured on mount.
const DEFAULT_W = 960;
const DEFAULT_H = 560;

const UNTAGGED_ID = "__untagged";

export function KnowledgeGraph({ tags, pages, edges, untaggedCount, untaggedPanel }: Props) {
  const router = useRouter();
  const [hover, setHover] = useState<{ node: SimNode; x: number; y: number } | null>(null);
  const [focusTag, setFocusTag] = useState<string | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [interactive, setInteractive] = useState(false);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [{ W, H }, setBox] = useState({ W: DEFAULT_W, H: DEFAULT_H });

  // The simulation packs bubbles into a fixed W x H area, so it has to track
  // the wrap's real rendered box or the graph stays capped at the fallback
  // size and reads as short-and-wide once the panel grows taller than that.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setBox({ W: width, H: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { nodes, bbox } = useMemo(() => {
    // Tags-only bubble pack: page dots and edges made the canvas noise, so
    // pages live in the side panel and the bubbles are scaled to fill ~55%
    // of the canvas area regardless of how many tags exist.
    const weights = tags.map((t) => Math.sqrt(Math.max(1, t.pages)));
    const untaggedWeight = untaggedCount > 0 ? Math.sqrt(untaggedCount) : 0;
    const totalWeight = weights.reduce((a, b) => a + b * b, 0) + untaggedWeight * untaggedWeight;
    const k = totalWeight > 0 ? Math.sqrt((0.55 * W * H) / (Math.PI * totalWeight)) : 1;
    const radius = (w: number) => Math.max(18, Math.min(130, k * w));

    const tagNodes: SimNode[] = tags.map((t, i) => ({
      id: t.id,
      kind: "tag",
      tier: t.tier,
      label: t.name,
      r: radius(weights[i]),
      pages: t.pages,
      tokens: t.tokens,
    }));
    const nodes = [...tagNodes];
    if (untaggedCount > 0) {
      nodes.push({
        id: UNTAGGED_ID,
        kind: "untagged",
        label: `untagged (${untaggedCount})`,
        r: radius(untaggedWeight),
      });
    }

    const sim = forceSimulation(nodes)
      .force("x", forceX(W / 2).strength(0.06))
      .force("y", forceY(H / 2).strength(0.09))
      .force("collide", forceCollide<SimNode>().radius((d) => d.r + 4).strength(1))
      .stop();
    for (let i = 0; i < 260; i++) sim.tick();

    const pad = 24;
    const xs = nodes.flatMap((n) => [(n.x ?? 0) - n.r, (n.x ?? 0) + n.r]);
    const ys = nodes.flatMap((n) => [(n.y ?? 0) - n.r, (n.y ?? 0) + n.r]);
    const bbox = {
      x: Math.min(...xs) - pad,
      y: Math.min(...ys) - pad,
      w: Math.max(...xs) - Math.min(...xs) + pad * 2,
      h: Math.max(...ys) - Math.min(...ys) + pad * 2,
    };
    return { nodes, bbox };
  }, [tags, untaggedCount, W, H]);

  const pagesByTag = useMemo(() => {
    const titleById = new Map(pages.map((p) => [p.id, p]));
    const map = new Map<string, GraphPage[]>();
    for (const e of edges) {
      const page = titleById.get(e.pageId);
      if (!page) continue;
      const list = map.get(e.tagId) ?? [];
      list.push(page);
      map.set(e.tagId, list);
    }
    return map;
  }, [pages, edges]);

  const dimmed = (n: SimNode) => (focusTag ? n.id !== focusTag : false);

  const focused = useMemo(() => {
    if (!focusTag) return null;
    const tag = nodes.find((n) => n.id === focusTag);
    if (!tag) return null;
    const tagPages = (pagesByTag.get(focusTag) ?? [])
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title));
    return { tag, pages: tagPages };
  }, [focusTag, nodes, pagesByTag]);

  if (nodes.length === 0) {
    return (
      <div className="kg-empty">
        Nothing tagged yet. Tag pages with concepts and they appear here as the org&apos;s
        knowledge graph.
      </div>
    );
  }

  const sidePanel =
    focusTag === UNTAGGED_ID && untaggedPanel ? (
      <aside className="kg-side">
        <div className="kg-side-head">
          <strong>untagged</strong>
          <button className="kg-side-close" onClick={() => setFocusTag(null)}>
            ✕
          </button>
        </div>
        {untaggedPanel}
      </aside>
    ) : focused && focused.tag.kind === "tag" ? (
      <aside className="kg-side">
        <div className="kg-side-head">
          <strong>{focused.tag.label}</strong>
          <button className="kg-side-close" onClick={() => setFocusTag(null)}>
            ✕
          </button>
        </div>
        <div className="kg-focus-head">
          {focused.pages.length} pages · ~{focused.tag.tokens} tokens to pull all
        </div>
        <ul className="activity-list">
          {focused.pages.map((p) => (
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
            </li>
          ))}
        </ul>
      </aside>
    ) : null;

  return (
    <div className="kg-wrap" ref={wrapRef}>
      <div className="kg-main">
      <svg
        viewBox={`${bbox.x - view.x} ${bbox.y - view.y} ${bbox.w / view.k} ${bbox.h / view.k}`}
        className="kg-svg"
        role="img"
        aria-label="Knowledge graph of tagged content"
        style={{ touchAction: interactive ? "none" : "pan-y" }}
        onWheel={(e) => {
          if (!interactive) return;
          const k = Math.min(4, Math.max(0.5, view.k * (e.deltaY < 0 ? 1.1 : 0.9)));
          setView((v) => ({ ...v, k }));
        }}
        onPointerDown={(e) => {
          if (!interactive) {
            setInteractive(true);
            return;
          }
          dragRef.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerMove={(e) => {
          if (!dragRef.current) return;
          const dx = (e.clientX - dragRef.current.x) / view.k;
          const dy = (e.clientY - dragRef.current.y) / view.k;
          dragRef.current = { x: e.clientX, y: e.clientY };
          setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
        }}
        onPointerUp={() => (dragRef.current = null)}
        onPointerLeave={() => (dragRef.current = null)}
      >
        <g>
          {nodes.map((n) => (
            <g
              key={n.id}
              transform={`translate(${n.x},${n.y})`}
              opacity={dimmed(n) ? 0.25 : 1}
              className={`kg-node kg-node-${n.kind}`}
              onPointerEnter={(e) => setHover({ node: n, x: e.clientX, y: e.clientY })}
              onPointerLeave={() => setHover(null)}
              onClick={() => setFocusTag(focusTag === n.id ? null : n.id)}
            >
              <circle r={n.r + 5} className="kg-halo" />
              <circle r={n.r} className={n.kind === "tag" ? `kg-circle-tag-${n.tier}` : `kg-circle-${n.kind}`} />
              {n.r >= 30 ? (
                <>
                  <text y={-2} textAnchor="middle" className="kg-label kg-label-in" style={{ fontSize: Math.min(16, n.r / 2.6) }}>
                    {n.label}
                  </text>
                  <text y={Math.min(16, n.r / 2.6) + 4} textAnchor="middle" className="kg-label-count" style={{ fontSize: Math.min(12, n.r / 3.4) }}>
                    {n.kind === "tag" ? `${n.pages} page${n.pages === 1 ? "" : "s"}` : ""}
                  </text>
                </>
              ) : (
                <text y={n.r + 14} textAnchor="middle" className="kg-label">
                  {n.label}
                </text>
              )}
            </g>
          ))}
        </g>
      </svg>
      <div className="kg-controls">
        {!interactive && <span className="kg-hint">click to zoom + pan</span>}
        {interactive && (
          <button
            className="kg-reset"
            onClick={() => {
              setView({ x: 0, y: 0, k: 1 });
              setInteractive(false);
            }}
          >
            full view
          </button>
        )}
        {focusTag && (
          <button className="kg-reset" onClick={() => setFocusTag(null)}>
            show all
          </button>
        )}
      </div>
      {sidePanel}
      </div>
      <div className="kg-legend">
        <span>
          <i className="kg-dot kg-circle-tag-default" /> Curata
        </span>
        <span>
          <i className="kg-dot kg-circle-tag-org" /> Organization
        </span>
        <span>
          <i className="kg-dot kg-circle-tag-personal" /> Personal
        </span>
        {untaggedCount > 0 && (
          <span>
            <i className="kg-dot kg-circle-untagged" /> Untagged
          </span>
        )}
      </div>
      {hover && (
        <div className="kg-tooltip" style={{ left: hover.x + 12, top: hover.y + 12 }}>
          <strong>{hover.node.label}</strong>
          {hover.node.kind === "tag" && (
            <div>
              {hover.node.tier} tag · {hover.node.pages} pages · ~{hover.node.tokens} tokens to pull
            </div>
          )}
          {hover.node.kind === "page" && <div>open page</div>}
          {hover.node.kind === "untagged" && <div>not tagged yet - click to tag</div>}
        </div>
      )}
    </div>
  );
}
