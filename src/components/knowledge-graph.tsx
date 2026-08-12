"use client";

import { useMemo, useRef, useState } from "react";
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
  kind: "tag" | "page" | "suggested";
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
  suggestedTags: string[];
}

const W = 960;
const H = 560;

function tagRadius(tokens: number, pages: number): number {
  // Token mass drives size (it is the cost of pulling the tag), page count
  // breaks ties; sqrt keeps big tags from swallowing the canvas.
  return Math.min(30, 10 + Math.sqrt(tokens / 200 + pages * 2));
}

export function KnowledgeGraph({ tags, pages, edges, suggestedTags }: Props) {
  const router = useRouter();
  const [hover, setHover] = useState<{ node: SimNode; x: number; y: number } | null>(null);
  const [focusTag, setFocusTag] = useState<string | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  const { nodes, links } = useMemo(() => {
    const tagNodes: SimNode[] = tags.map((t) => ({
      id: t.id,
      kind: "tag",
      tier: t.tier,
      label: t.name,
      r: tagRadius(t.tokens, t.pages),
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
    const ghostNodes: SimNode[] = suggestedTags.map((name) => ({
      id: `suggested:${name}`,
      kind: "suggested",
      label: name,
      r: 12,
    }));
    const nodes = [...tagNodes, ...pageNodes, ...ghostNodes];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const links = edges.flatMap((e) => {
      const source = byId.get(e.tagId);
      const target = byId.get(e.pageId);
      return source && target ? [{ source, target }] : [];
    });

    const sim = forceSimulation(nodes)
      .force("link", forceLink(links).distance(46).strength(0.6))
      .force("charge", forceManyBody().strength(-60))
      .force("center", forceCenter(W / 2, H / 2))
      .force("collide", forceCollide<SimNode>().radius((d) => d.r + 6))
      .stop();
    for (let i = 0; i < 180; i++) sim.tick();
    return { nodes, links };
  }, [tags, pages, edges, suggestedTags]);

  const neighbors = useMemo(() => {
    if (!focusTag) return null;
    const set = new Set<string>([focusTag]);
    for (const l of links) {
      if (l.source.id === focusTag) set.add(l.target.id);
    }
    return set;
  }, [focusTag, links]);

  const dimmed = (n: SimNode) => (neighbors ? !neighbors.has(n.id) : false);

  if (nodes.length === 0) {
    return (
      <div className="kg-empty">
        Nothing tagged yet. Tag pages with concepts and they appear here — untagged pages are
        invisible to agents.
      </div>
    );
  }

  return (
    <div className="kg-wrap">
      <svg
        viewBox={`${-view.x} ${-view.y} ${W / view.k} ${H / view.k}`}
        className="kg-svg"
        role="img"
        aria-label="Knowledge graph of tagged content"
        onWheel={(e) => {
          const k = Math.min(4, Math.max(0.5, view.k * (e.deltaY < 0 ? 1.1 : 0.9)));
          setView((v) => ({ ...v, k }));
        }}
        onPointerDown={(e) => {
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
                else if (n.kind === "tag") setFocusTag(focusTag === n.id ? null : n.id);
              }}
            >
              <circle r={n.r} className={n.kind === "tag" ? `kg-circle-tag-${n.tier}` : `kg-circle-${n.kind}`} />
              {n.kind !== "page" && (
                <text y={n.r + 12} textAnchor="middle" className="kg-label">
                  {n.label}
                </text>
              )}
            </g>
          ))}
        </g>
      </svg>
      <div className="kg-legend">
        <span>
          <i className="kg-dot kg-circle-tag-org" /> org tag (used by 2+ people)
        </span>
        <span>
          <i className="kg-dot kg-circle-tag-default" /> curata default
        </span>
        <span>
          <i className="kg-dot kg-circle-tag-personal" /> personal (one person so far)
        </span>
        <span>
          <i className="kg-dot kg-circle-page" /> page
        </span>
        {suggestedTags.length > 0 && (
          <span>
            <i className="kg-dot kg-circle-suggested" /> suggested (unused default)
          </span>
        )}
        {focusTag && (
          <button className="kg-clear" onClick={() => setFocusTag(null)}>
            clear focus
          </button>
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
          {hover.node.kind === "suggested" && <div>default tag, not used yet</div>}
        </div>
      )}
    </div>
  );
}
