"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
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

const W = 960;
const H = 560;

const UNTAGGED_ID = "__untagged";

function tagRadius(pages: number): number {
  // Page count drives size — more tagged pages, bigger bubble; sqrt keeps
  // big tags from swallowing the canvas. Token cost lives in the tooltip.
  return Math.min(34, 8 + 4 * Math.sqrt(pages));
}

export function KnowledgeGraph({ tags, pages, edges, untaggedCount, untaggedPanel }: Props) {
  const router = useRouter();
  const [hover, setHover] = useState<{ node: SimNode; x: number; y: number } | null>(null);
  const [focusTag, setFocusTag] = useState<string | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [interactive, setInteractive] = useState(false);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  const { nodes, links, bbox } = useMemo(() => {
    const tagNodes: SimNode[] = tags.map((t) => ({
      id: t.id,
      kind: "tag",
      tier: t.tier,
      label: t.name,
      r: tagRadius(t.pages),
      pages: t.pages,
      tokens: t.tokens,
    }));
    const pageNodes: SimNode[] = pages.map((p) => ({
      id: p.id,
      kind: "page",
      label: p.title,
      r: 5,
      slug: p.slug,
    }));
    const nodes = [...tagNodes, ...pageNodes];
    if (untaggedCount > 0) {
      nodes.push({
        id: UNTAGGED_ID,
        kind: "untagged",
        label: `untagged (${untaggedCount})`,
        r: tagRadius(untaggedCount),
      });
    }
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const links = edges.flatMap((e) => {
      const source = byId.get(e.tagId);
      const target = byId.get(e.pageId);
      return source && target ? [{ source, target }] : [];
    });

    const sim = forceSimulation(nodes)
      .force("link", forceLink(links).distance(52).strength(0.6))
      .force("charge", forceManyBody().strength(-90))
      .force("center", forceCenter(W / 2, H / 2))
      .force("collide", forceCollide<SimNode>().radius((d) => d.r + 10))
      .stop();
    for (let i = 0; i < 200; i++) sim.tick();

    // Fit the viewport to where the simulation actually put things — a sparse
    // graph otherwise floats as a speck in a fixed frame.
    const pad = 70;
    const xs = nodes.map((n) => n.x ?? 0);
    const ys = nodes.map((n) => n.y ?? 0);
    const bbox = {
      x: Math.min(...xs) - pad,
      y: Math.min(...ys) - pad,
      w: Math.max(...xs) - Math.min(...xs) + pad * 2,
      h: Math.max(...ys) - Math.min(...ys) + pad * 2,
    };
    return { nodes, links, bbox };
  }, [tags, pages, edges, untaggedCount]);

  const neighbors = useMemo(() => {
    if (!focusTag) return null;
    const set = new Set<string>([focusTag]);
    for (const l of links) {
      if (l.source.id === focusTag) set.add(l.target.id);
    }
    return set;
  }, [focusTag, links]);

  const dimmed = (n: SimNode) => (neighbors ? !neighbors.has(n.id) : false);

  const focused = useMemo(() => {
    if (!focusTag) return null;
    const tag = nodes.find((n) => n.id === focusTag);
    if (!tag) return null;
    const pages = links
      .filter((l) => l.source.id === focusTag && l.target.kind === "page")
      .map((l) => l.target)
      .sort((a, b) => a.label.localeCompare(b.label));
    return { tag, pages };
  }, [focusTag, nodes, links]);

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
                    {p.label}
                  </a>
                </span>
              </span>
            </li>
          ))}
        </ul>
      </aside>
    ) : null;

  return (
    <div className="kg-wrap">
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
          {links.map((l, i) => (
            <line
              key={i}
              x1={l.source.x}
              y1={l.source.y}
              x2={l.target.x}
              y2={l.target.y}
              className="kg-edge"
              opacity={dimmed(l.source) || dimmed(l.target) ? 0.08 : 0.3}
            />
          ))}
          {nodes.map((n) => (
            <g
              key={n.id}
              transform={`translate(${n.x},${n.y})`}
              opacity={dimmed(n) ? 0.15 : 1}
              className={`kg-node kg-node-${n.kind}`}
              onPointerEnter={(e) => setHover({ node: n, x: e.clientX, y: e.clientY })}
              onPointerLeave={() => setHover(null)}
              onClick={() => {
                if (n.kind === "page" && n.slug) router.push(`/pages/${n.slug}`);
                else setFocusTag(focusTag === n.id ? null : n.id);
              }}
            >
              {n.kind !== "page" && <circle r={n.r + 5} className="kg-halo" />}
              <circle r={n.r} className={n.kind === "tag" ? `kg-circle-tag-${n.tier}` : `kg-circle-${n.kind}`} />
              {n.kind !== "page" && (
                <text y={n.r + 18} textAnchor="middle" className="kg-label">
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
        <span>
          <i className="kg-dot kg-circle-page" /> Page
        </span>
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
