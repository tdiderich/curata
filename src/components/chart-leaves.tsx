"use client";

import { useState } from "react";
import Link from "next/link";
import type { ChartChild } from "@/lib/chart";

export const LEAF_PREVIEW = 8;

export function faviconUrl(host: string) {
  return `https://www.google.com/s2/favicons?sz=32&domain=${encodeURIComponent(host)}`;
}

/** Site icon for an external asset. Plain <img>: a third-party 14px icon isn't worth the image pipeline. */
export function Favicon({ host, inline = false }: { host: string; inline?: boolean }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={`chart-leaf-favicon${inline ? " chart-row-favicon" : ""}`} src={faviconUrl(host)} alt="" width={14} height={14} loading="lazy" />;
}

/**
 * The content stacked under a node card. Rows come worst-first, so the
 * first few are the ones that matter; past LEAF_PREVIEW the rest fold
 * behind "Show all N" so a node with 100 things under it stays one column.
 */
export function ChartLeaves({ children }: { children: ChartChild[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? children : children.slice(0, LEAF_PREVIEW);
  const hidden = children.length - shown.length;
  return (
    <ul className="chart-leaves">
      {shown.map((c) => (
        <li key={c.edgeId} className={`chart-leaf chart-leaf--${c.color}`}>
          <span className={`chart-dot chart-dot--${c.color}`} />
          {c.kind === "page" && c.slug
            ? <Link href={`/pages/${c.slug}`} className="chart-leaf-label" title={c.reason ?? ""}>{c.label}</Link>
            : <a href={c.url ?? "#"} target="_blank" rel="noreferrer" className="chart-leaf-label" title={`${c.host ?? ""}${c.reason ? ` · ${c.reason}` : ""}`}>{c.label}</a>}
          {c.kind === "external" && c.host && <Favicon host={c.host} />}
        </li>
      ))}
      {hidden > 0 && (
        <li className="chart-leaf chart-leaf--more">
          <button type="button" className="chart-leaf-more" onClick={() => setAll(true)}>Show all {children.length}</button>
        </li>
      )}
      {all && children.length > LEAF_PREVIEW && (
        <li className="chart-leaf chart-leaf--more">
          <button type="button" className="chart-leaf-more" onClick={() => setAll(false)}>Show fewer</button>
        </li>
      )}
    </ul>
  );
}
