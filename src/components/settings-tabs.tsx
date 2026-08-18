"use client";

import { Fragment, useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";

interface Tab {
  label: string;
  /** Optional extra node rendered after the label text (e.g. a TeamChip) —
   * kept separate from `label` so slugify()/the URL param stay plain text. */
  labelExtra?: React.ReactNode;
  content: React.ReactNode;
  /** Optional section name (e.g. "General", "Access"). When any tab in the
   * list has a group, the bar renders grouped with dividers/labels; when
   * none do, it renders as the original flat bar. */
  group?: string;
}

function slugify(label: string) {
  return label.toLowerCase().replace(/\s+/g, "-");
}

/** Splits tabs into contiguous runs sharing the same `group` value, in
 * source order. Ungrouped tabs (group === undefined) each become their own
 * single-tab segment so they still render, just without a group label. */
function groupTabs(tabs: Tab[]) {
  const segments: { group?: string; indices: number[] }[] = [];
  tabs.forEach((tab, i) => {
    const last = segments[segments.length - 1];
    if (last && last.group === tab.group && tab.group !== undefined) {
      last.indices.push(i);
    } else {
      segments.push({ group: tab.group, indices: [i] });
    }
  });
  return segments;
}

export function SettingsTabs({ tabs }: { tabs: Tab[] }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const resolveIndex = useCallback(() => {
    const param = searchParams.get("tab");
    if (!param) return 0;
    const idx = tabs.findIndex((t) => slugify(t.label) === param);
    return idx >= 0 ? idx : 0;
  }, [searchParams, tabs]);

  const [active, setActive] = useState(resolveIndex);

  useEffect(() => {
    queueMicrotask(() => setActive(resolveIndex()));
  }, [resolveIndex]);

  function selectTab(i: number) {
    setActive(i);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", slugify(tabs[i].label));
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const isGrouped = tabs.some((t) => t.group);

  const renderTabButton = (tab: Tab, i: number) => (
    <button
      key={tab.label}
      className={`settings-tab${i === active ? " settings-tab--active" : ""}`}
      onClick={() => selectTab(i)}
    >
      {tab.label}
      {tab.labelExtra}
    </button>
  );

  return (
    <div className="settings-tabs">
      <nav className={`settings-tab-bar${isGrouped ? " settings-tab-bar--grouped" : ""}`}>
        {isGrouped
          ? groupTabs(tabs).map((segment, segIdx) => (
              <Fragment key={segment.group ?? `ungrouped-${segIdx}`}>
                {segIdx > 0 && <div className="settings-tab-group-divider" aria-hidden="true" />}
                <div className="settings-tab-group">
                  {segment.group ? (
                    <div className="settings-tab-group-label">{segment.group}</div>
                  ) : null}
                  <div className="settings-tab-group-buttons">
                    {segment.indices.map((i) => renderTabButton(tabs[i], i))}
                  </div>
                </div>
              </Fragment>
            ))
          : tabs.map((tab, i) => renderTabButton(tab, i))}
      </nav>
      <div className="settings-tab-content">
        {tabs[active].content}
      </div>
    </div>
  );
}
