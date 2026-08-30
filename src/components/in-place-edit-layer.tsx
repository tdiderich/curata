"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { bindRoot, getAt, setAt, pathLabel, type Binding, type ListTarget, type MissingField, type Path } from "@/lib/visual-edit-bind";

/**
 * Lays invisible click targets over every tagged content element in
 * `rootRef`'s rendered output and swaps in a matching text input on click.
 * Also offers "+ item" on tagged list containers. Positions are relative to
 * `containerRef`, which must be `position: relative` and contain the root; the
 * layer itself must NOT be inside the root (it re-measures on DOM mutations).
 *
 * Used by the full-page edit mode and by the component editor sheet.
 */

interface Rect { left: number; top: number; width: number; height: number }
interface OverlayRect extends Rect { i: number; group: string | null; block: boolean; text: Rect }
interface ListRect extends Rect { i: number; group: string | null; label: string }

interface EditingState {
  index: number;
  value: string;
  rect: Rect;
  style: React.CSSProperties;
  label: string;
  block: boolean;
}

export interface InPlaceEditLayerProps {
  rootRef: RefObject<HTMLElement | null>;
  containerRef: RefObject<HTMLElement | null>;
  data: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  enabled?: boolean;
  /** Group key for a path; hints show for the group under the mouse. Default: one group. */
  bindingGroup?: (path: Path, data: Record<string, unknown>) => string | null;
  /** Group key for the element under the mouse. Default: one group. */
  hoverGroup?: (el: Element) => string | null;
  onMissing?: (fields: MissingField[]) => void;
  /** Ask the layer to start editing the binding at `path` once it exists. Bump `seq` per request. */
  requestEdit?: { path: Path; seq: number } | null;
}

const ALL = "*";

export function InPlaceEditLayer({
  rootRef,
  containerRef,
  data,
  onChange,
  enabled = true,
  bindingGroup,
  hoverGroup,
  onMissing,
  requestEdit,
}: InPlaceEditLayerProps) {
  const bindingsRef = useRef<Binding[]>([]);
  const listsRef = useRef<ListTarget[]>([]);
  const [overlays, setOverlays] = useState<OverlayRect[]>([]);
  const [listRects, setListRects] = useState<ListRect[]>([]);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const editingRef = useRef<EditingState | null>(null);
  useEffect(() => { editingRef.current = editing; }, [editing]);
  const pendingPathRef = useRef<string | null>(null);
  const [tick, setTick] = useState(0);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dataRef = useRef(data);
  useEffect(() => { dataRef.current = data; }, [data]);

  const measure = useCallback(() => {
    const root = rootRef.current;
    const container = containerRef.current;
    if (!root || !container || !enabled) {
      bindingsRef.current = [];
      listsRef.current = [];
      setOverlays([]);
      setListRects([]);
      return;
    }
    const { bindings, lists, missing } = bindRoot(root, data);
    bindingsRef.current = bindings;
    listsRef.current = lists;
    const cr = container.getBoundingClientRect();
    const rel = (x: DOMRect): Rect => ({
      left: x.left - cr.left + container.scrollLeft,
      top: x.top - cr.top + container.scrollTop,
      width: x.width,
      height: x.height,
    });
    setOverlays(bindings.map((b, i) => {
      const box = b.el.getBoundingClientRect();
      let text = box;
      if (!b.block && b.textNode) {
        const range = document.createRange();
        range.selectNodeContents(b.textNode);
        const tr = range.getBoundingClientRect();
        if (tr.width > 0 && tr.height > 0) text = tr;
      }
      return {
        i,
        ...rel(box),
        group: bindingGroup ? bindingGroup(b.path, data) : ALL,
        block: b.block,
        text: rel(text),
      };
    }));
    setListRects(lists.map((l, i) => ({
      i,
      ...rel(l.el.getBoundingClientRect()),
      group: bindingGroup ? bindingGroup(l.path, data) : ALL,
      label: l.itemLabel,
    })));
    onMissing?.(missing);
  }, [rootRef, containerRef, data, enabled, bindingGroup, onMissing]);

  useLayoutEffect(() => {
    measure();
  }, [measure, tick]);

  // Re-measure when the rendered DOM changes (tabs, accordions, drag collapse,
  // fonts/images settling) or the container resizes.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !enabled) return;
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; setTick((t) => t + 1); });
    };
    const mo = new MutationObserver(schedule);
    mo.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "style", "hidden", "open"] });
    const ro = new ResizeObserver(schedule);
    ro.observe(root);
    window.addEventListener("resize", schedule);
    return () => {
      mo.disconnect();
      ro.disconnect();
      window.removeEventListener("resize", schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [rootRef, enabled]);

  // Which group is under the mouse (for scoped hint outlines and "+ item").
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;
    const onMove = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target) return;
      const own = target.closest<HTMLElement>(".ve-hit, .ve-add");
      const key = own ? (own.dataset.group ?? ALL) : hoverGroup ? hoverGroup(target) : ALL;
      setHoverKey((k) => (k === key ? k : key));
    };
    const onLeave = () => setHoverKey(null);
    container.addEventListener("mousemove", onMove);
    container.addEventListener("mouseleave", onLeave);
    return () => {
      container.removeEventListener("mousemove", onMove);
      container.removeEventListener("mouseleave", onLeave);
    };
  }, [containerRef, enabled, hoverGroup]);

  const startEdit = useCallback((index: number) => {
    const b = bindingsRef.current[index];
    const o = overlays.find((x) => x.i === index);
    if (!b || !o) return;
    const sample = b.block ? b.el : (b.textNode?.parentElement ?? b.el);
    const cs = getComputedStyle(sample);
    const raw = getAt(dataRef.current, b.path);
    setEditing({
      index,
      value: raw === undefined || raw === null ? "" : String(raw),
      rect: b.block ? { left: o.left, top: o.top, width: o.width, height: o.height } : o.text,
      style: {
        fontFamily: cs.fontFamily,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight as React.CSSProperties["fontWeight"],
        fontStyle: cs.fontStyle,
        lineHeight: cs.lineHeight,
        letterSpacing: cs.letterSpacing,
        textTransform: cs.textTransform as React.CSSProperties["textTransform"],
        textAlign: cs.textAlign as React.CSSProperties["textAlign"],
        color: cs.color,
      },
      label: pathLabel(b.path),
      block: b.block,
    });
  }, [overlays]);

  // Open a specific path once it is rendered: after Tab, after "+ item", or on external request.
  const lastRequestSeq = useRef(0);
  useEffect(() => {
    let want = pendingPathRef.current;
    if (!want && requestEdit && requestEdit.seq !== lastRequestSeq.current) want = pathLabel(requestEdit.path);
    if (!want) return;
    const idx = bindingsRef.current.findIndex((b) => pathLabel(b.path) === want);
    if (idx === -1) return; // not rendered yet; retry on next overlays change
    if (pendingPathRef.current === want) pendingPathRef.current = null;
    else if (requestEdit) lastRequestSeq.current = requestEdit.seq;
    startEdit(idx);
  }, [overlays, requestEdit, startEdit]);

  const commitEdit = useCallback((nextIndex: number | null = null) => {
    const ed = editingRef.current;
    if (!ed) return;
    const b = bindingsRef.current[ed.index];
    setEditing(null);
    if (!b) return;
    const current = dataRef.current;
    const prev = getAt(current, b.path);
    let value: unknown = ed.value;
    if (b.kind === "number") {
      const n = Number(ed.value.trim());
      value = ed.value.trim() !== "" && Number.isFinite(n) ? n : ed.value;
    }
    if (nextIndex !== null) {
      const nb = bindingsRef.current[nextIndex];
      pendingPathRef.current = nb ? pathLabel(nb.path) : null;
    }
    if (value === prev) {
      if (nextIndex !== null) setTick((t) => t + 1);
      return;
    }
    onChange(setAt(current, b.path, value));
  }, [onChange]);

  const addItem = useCallback((listIndex: number) => {
    const l = listsRef.current[listIndex];
    if (!l) return;
    const current = dataRef.current;
    const arr = (getAt(current, l.path) as unknown[] | undefined) || [];
    const item = l.makeItem(current);
    let focus = l.focusField;
    if (!focus && l.itemLabel === "Row") {
      const cols = (getAt(current, [...l.path.slice(0, -1), "columns"]) as Array<{ key: string }> | undefined) || [];
      focus = cols[0]?.key ?? null;
    }
    if (focus) pendingPathRef.current = pathLabel([...l.path, arr.length, focus]);
    onChange(setAt(current, l.path, [...arr, item]));
  }, [onChange]);

  useEffect(() => {
    if (!editing) return;
    const ta = inputRef.current;
    if (!ta) return;
    ta.focus();
    ta.select();
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [editing?.index]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!enabled) return null;

  const visible = (g: string | null) => hoverKey !== null && (g === ALL || hoverKey === ALL || g === hoverKey);

  return (
    <>
      {overlays.map((o) => (
        <div
          key={o.i}
          className={`ve-hit${o.block ? " ve-hit--block" : ""}${visible(o.group) ? " ve-hit--hint" : ""}${editing?.index === o.i ? " ve-hit--active" : ""}`}
          style={{ left: o.left, top: o.top, width: o.width, height: o.height }}
          title={o.block ? "Click to edit source" : "Click to edit"}
          data-group={o.group ?? undefined}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (editingRef.current) {
              if (editingRef.current.index === o.i) return;
              commitEdit(o.i);
            } else {
              startEdit(o.i);
            }
          }}
        />
      ))}
      {listRects.map((l) => (
        <button
          key={`list-${l.i}`}
          type="button"
          className={`ve-add${visible(l.group) ? " ve-add--visible" : ""}`}
          style={{ left: l.left + l.width / 2, top: l.top + l.height }}
          data-group={l.group ?? undefined}
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onClick={(e) => { e.stopPropagation(); if (editingRef.current) commitEdit(); addItem(l.i); }}
        >
          + {l.label}
        </button>
      ))}
      {editing && (
        <>
          <span className="ve-path" style={{ left: editing.rect.left, top: editing.rect.top - 20 }}>
            {editing.label}{editing.block ? " · source · ⌘↵ to apply" : ""}
          </span>
          <textarea
            ref={inputRef}
            className={`ve-input${editing.block ? " ve-input--block" : ""}`}
            rows={1}
            value={editing.value}
            style={editing.block ? {
              ...editing.style,
              left: editing.rect.left - 6,
              top: editing.rect.top - 6,
              width: editing.rect.width + 12,
              minHeight: editing.rect.height + 12,
            } : {
              ...editing.style,
              left: editing.rect.left - 4,
              top: editing.rect.top - 2,
              minWidth: Math.max(editing.rect.width + 24, 60),
              maxWidth: `calc(100% - ${Math.max(editing.rect.left - 4, 0)}px)`,
            }}
            onChange={(e) => {
              const v = e.target.value;
              setEditing((s) => (s ? { ...s, value: v } : s));
              const ta = e.target;
              ta.style.height = "auto";
              ta.style.height = `${ta.scrollHeight}px`;
            }}
            onBlur={() => commitEdit()}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (editing.block ? (e.metaKey || e.ctrlKey) : !e.shiftKey)) { e.preventDefault(); commitEdit(); }
              else if (e.key === "Tab") {
                e.preventDefault();
                const next = editing.index + (e.shiftKey ? -1 : 1);
                if (next >= 0 && next < bindingsRef.current.length) commitEdit(next);
                else commitEdit();
              } else if (e.key === "Escape") { e.stopPropagation(); setEditing(null); }
              else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.stopPropagation(); }
            }}
          />
        </>
      )}
    </>
  );
}
