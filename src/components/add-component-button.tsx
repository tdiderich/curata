"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { PALETTE, type PaletteEntry } from "@/lib/component-palette";
import { basePath } from "@/lib/api-fetch";
import yaml from "js-yaml";

interface AddComponentButtonProps {
  onAdd: (component: Record<string, unknown>) => void;
  disabled?: boolean;
}

interface PageResult {
  slug: string;
  title: string;
}

const GROUPS = ["Text", "Data", "Structure", "Layout", "Sequence", "Interactive", "Meta"];

function MirrorPageSearch({ onSelect, onBack }: { onSelect: (slug: string, title: string) => void; onBack: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PageResult[]>([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    if (!value.trim()) {
      setResults([]);
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`${basePath}/api/search?query=${encodeURIComponent(value)}`);
        if (res.ok) {
          const data = (await res.json()) as PageResult[];
          setResults(data.filter((r) => r.slug && r.title));
        }
      } catch { /* ignore */ }
      setLoading(false);
    }, 200);
  }, []);

  return (
    <>
      <div className="add-component-header">
        <button className="mirror-back-btn" onClick={onBack} aria-label="Back to components">&larr;</button>
        <input
          className="add-component-search"
          type="text"
          placeholder="Search pages to mirror..."
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          autoFocus
        />
      </div>
      <div className="add-component-list">
        {loading && <div className="add-component-empty">Searching...</div>}
        {!loading && query && results.length === 0 && (
          <div className="add-component-empty">No pages found</div>
        )}
        {!loading && !query && (
          <div className="add-component-empty">Type to search for a page</div>
        )}
        {results.map((r) => (
          <button key={r.slug} className="add-component-item" onClick={() => onSelect(r.slug, r.title)}>
            <span className="add-component-item-label">{r.title}</span>
            <span className="add-component-item-desc">{r.slug}</span>
          </button>
        ))}
      </div>
    </>
  );
}

export function AddComponentButton({ onAdd, disabled }: AddComponentButtonProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [mirrorMode, setMirrorMode] = useState(false);

  const filtered = useMemo(() => {
    if (!filter) return PALETTE;
    const q = filter.toLowerCase();
    return PALETTE.filter(
      (e) => e.label.toLowerCase().includes(q) || e.type.toLowerCase().includes(q) || e.description.toLowerCase().includes(q),
    );
  }, [filter]);

  const grouped = useMemo(() => {
    const map = new Map<string, PaletteEntry[]>();
    for (const g of GROUPS) map.set(g, []);
    for (const e of filtered) {
      const arr = map.get(e.group);
      if (arr) arr.push(e);
    }
    return [...map.entries()].filter(([, entries]) => entries.length > 0);
  }, [filtered]);

  const close = useCallback(() => {
    setOpen(false);
    setFilter("");
    setMirrorMode(false);
  }, []);

  const handleSelect = useCallback(
    (entry: PaletteEntry) => {
      if (entry.mirror) {
        setMirrorMode(true);
        return;
      }
      const stub = entry.stub.replace(/^- /, "");
      const parsed = yaml.load(stub) as Record<string, unknown>;
      onAdd(parsed);
      close();
    },
    [onAdd, close],
  );

  const handleMirrorSelect = useCallback(
    (slug: string, title: string) => {
      onAdd({ type: "section", heading: title, slug });
      close();
    },
    [onAdd, close],
  );

  return (
    <>
      <button
        className="add-component-btn"
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-label="Add component"
      >
        + Add Component
      </button>

      {open && (
        <div className="add-component-overlay" onClick={close}>
          <div className="add-component-modal" onClick={(e) => e.stopPropagation()}>
            {mirrorMode ? (
              <MirrorPageSearch
                onSelect={handleMirrorSelect}
                onBack={() => setMirrorMode(false)}
              />
            ) : (
              <>
                <div className="add-component-header">
                  <input
                    className="add-component-search"
                    type="text"
                    placeholder="Search components..."
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    autoFocus
                  />
                  <button className="add-component-close" onClick={close}>
                    &times;
                  </button>
                </div>
                <div className="add-component-list">
                  {grouped.map(([group, entries]) => (
                    <div key={group} className="add-component-group">
                      <div className="add-component-group-label">{group}</div>
                      {entries.map((entry) => (
                        <button
                          key={`${entry.type}-${entry.label}`}
                          className={`add-component-item${entry.mirror ? " add-component-item--mirror" : ""}`}
                          onClick={() => handleSelect(entry)}
                        >
                          <span className="add-component-item-label">{entry.label}</span>
                          <span className="add-component-item-desc">{entry.description}</span>
                        </button>
                      ))}
                    </div>
                  ))}
                  {grouped.length === 0 && (
                    <div className="add-component-empty">No matching components</div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
