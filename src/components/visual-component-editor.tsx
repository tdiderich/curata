"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import yaml from "js-yaml";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { yaml as yamlLang } from "@codemirror/lang-yaml";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { autocompletion } from "@codemirror/autocomplete";
import { basePath } from "@/lib/api-fetch";
import { PageRenderer, ComponentFieldEditor, type PageData, type ComponentData } from "@/generated/kazam-renderer";
import { pathLabel, type MissingField } from "@/lib/visual-edit-bind";
import { InPlaceEditLayer } from "./in-place-edit-layer";

type Tab = "visual" | "fields" | "yaml";

interface Props {
  slug: string;
  componentId: string;
  componentType: string;
  pageJson?: PageData;
  /** Component object (without `id`). When omitted the editor fetches it. */
  initialComponent?: Record<string, unknown>;
  autoTrust?: boolean;
  onClose: () => void;
  onSaved: () => void;
  onLocalSave?: (componentId: string, parsed: Record<string, unknown>) => void;
}

const dumpYaml = (c: Record<string, unknown>) =>
  yaml.dump(c, { lineWidth: -1, noRefs: true, quotingType: '"', forceQuotes: false }).trimEnd();

/**
 * Full-screen component editor. "Visual" renders the component exactly as it
 * appears on the page and lets you click any text to edit it in place; "Fields"
 * is the generated structured form; "YAML" is the raw source. All three edit
 * the same in-memory object.
 */
export default function VisualComponentEditor({
  slug,
  componentId,
  componentType,
  pageJson,
  initialComponent,
  autoTrust,
  onClose,
  onSaved,
  onLocalSave,
}: Props) {
  const [comp, setComp] = useState<Record<string, unknown> | null>(initialComponent ?? null);
  const savedRef = useRef<Record<string, unknown> | null>(initialComponent ?? null);
  const hashRef = useRef("");
  const [loading, setLoading] = useState(initialComponent === undefined);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("visual");

  // Visual tab state
  const canvasRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [unbound, setUnbound] = useState<MissingField[]>([]);
  const sheetData = useMemo(() => ({ components: [comp] }), [comp]);

  // YAML tab state
  const yamlTextRef = useRef("");
  const [yamlSeed, setYamlSeed] = useState("");

  // Load when the parent couldn't supply the component inline.
  useEffect(() => {
    if (initialComponent !== undefined) return;
    fetch(`${basePath}/api/pages/component-yaml?slug=${encodeURIComponent(slug)}&id=${encodeURIComponent(componentId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          try {
            const parsed = yaml.load(data.yaml) as Record<string, unknown>;
            savedRef.current = parsed;
            setComp(parsed);
            hashRef.current = data.contentHash;
          } catch (e) {
            setError(e instanceof Error ? e.message : "Invalid YAML");
          }
        }
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load component");
        setLoading(false);
      });
  }, [slug, componentId, initialComponent]);

  const update = useCallback((next: Record<string, unknown>) => {
    setComp(next);
    setDirty(true);
    setError("");
  }, []);

  // ── Tab switching: YAML must parse before leaving it ──
  const commitYaml = useCallback((): Record<string, unknown> | null => {
    try {
      const parsed = yaml.load(yamlTextRef.current) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("must be a YAML object");
      return parsed;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid YAML");
      return null;
    }
  }, []);

  const switchTab = useCallback((next: Tab) => {
    if (next === tab) return;
    if (tab === "yaml") {
      const parsed = commitYaml();
      if (!parsed) return;
      if (yamlTextRef.current !== (comp ? dumpYaml(comp) : "")) update(parsed);
      else setComp(parsed);
    }
    if (next === "yaml" && comp) {
      const text = dumpYaml(comp);
      yamlTextRef.current = text;
      setYamlSeed(text);
    }
    setError("");
    setTab(next);
  }, [tab, comp, commitYaml, update]);

  // ── Save / discard ──
  const save = useCallback(async () => {
    let current = comp;
    if (tab === "yaml") {
      const parsed = commitYaml();
      if (!parsed) return false;
      current = parsed;
      setComp(parsed);
    }
    if (!current) return false;

    if (onLocalSave) {
      onLocalSave(componentId, current);
      savedRef.current = current;
      setDirty(false);
      onSaved();
      return true;
    }

    setSaving(true);
    setError("");
    try {
      const res = await fetch(`${basePath}/api/pages/component-yaml`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, id: componentId, yaml: dumpYaml(current), expectedHash: hashRef.current, autoTrust }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        hashRef.current = data.contentHash;
        savedRef.current = current;
        setDirty(false);
        setSaving(false);
        onSaved();
        return true;
      }
      setError(data.error || "Save failed");
    } catch {
      setError("Network error");
    }
    setSaving(false);
    return false;
  }, [comp, tab, commitYaml, onLocalSave, componentId, onSaved, slug, autoTrust]);

  const discard = useCallback(() => {
    const base = savedRef.current;
    if (!base) return;
    setComp(base);
    setDirty(false);
    setError("");
    if (tab === "yaml") {
      const text = dumpYaml(base);
      yamlTextRef.current = text;
      setYamlSeed(text + "\n"); // force remount even if identical text
    }
  }, [tab]);

  const done = useCallback(async () => {
    if (document.activeElement?.classList.contains("ve-input")) return; // inline edit commits on blur first
    if (dirty || tab === "yaml") {
      const ok = await save();
      if (!ok && dirty) return;
    }
    onClose();
  }, [dirty, tab, save, onClose]);

  // Escape: cancel inline edit, otherwise behave like Done.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if ((e.target as HTMLElement | null)?.classList.contains("ve-input")) return; // layer handles it
      if ((e.target as HTMLElement | null)?.closest(".cm-editor")) return; // CM handles its own
      done();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [done]);

  // Memoize the rendered preview so hover/edit state never re-renders kazam output.
  const preview = useMemo(() => {
    if (!comp) return null;
    const base = (pageJson ?? { title: "", components: [] }) as PageData;
    return (
      <PageRenderer
        page={{
          ...base,
          shell: "standard",
          components: [comp as ComponentData],
          slides: undefined,
          hub: undefined,
          freshness: undefined,
        } as PageData}
      />
    );
  }, [comp, pageJson]);

  const unboundChips = useMemo(() => {
    const seen = new Set<string>();
    return unbound.filter((l) => {
      const k = pathLabel(l.path);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [unbound]);

  const headerBtns = (
    <>
      {error && <span className="inline-editor-error" title={error}>{error}</span>}
      {dirty && (
        <button className="inline-editor-btn inline-editor-btn--discard" onClick={discard}>Discard</button>
      )}
      <button className="inline-editor-btn inline-editor-btn--save" disabled={(!dirty && tab !== "yaml") || saving} onClick={() => { void save(); }}>
        {saving ? "Saving..." : "Save"}
      </button>
      <button className="inline-editor-btn inline-editor-btn--close" onClick={() => { void done(); }}>Done</button>
    </>
  );

  return (
    <div className="ve-overlay-root" onMouseDown={(e) => { if (e.target === e.currentTarget) void done(); }}>
      <div className="ve-sheet" role="dialog" aria-label={`Edit ${componentType}`}>
        <div className="ve-header">
          <span className="inline-editor-type">{componentType}</span>
          <span className="inline-editor-id">{componentId}</span>
          <div className="ve-tabs" role="tablist">
            {(["visual", "fields", "yaml"] as Tab[]).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                className={`ve-tab${tab === t ? " ve-tab--active" : ""}`}
                onClick={() => switchTab(t)}
              >
                {t === "visual" ? "Visual" : t === "fields" ? "Fields" : "YAML"}
              </button>
            ))}
          </div>
          <div className="inline-editor-spacer" />
          {headerBtns}
        </div>

        <div className="ve-body">
          {loading || !comp ? (
            <div className="inline-editor-loading">{error || "Loading component..."}</div>
          ) : tab === "visual" ? (
            <>
              <div ref={canvasRef} className="ve-canvas">
                <div ref={innerRef} className="page-detail-content ve-canvas-inner">
                  {preview}
                </div>
                <InPlaceEditLayer
                  rootRef={innerRef}
                  containerRef={canvasRef}
                  data={sheetData}
                  onChange={(next) => update((next.components as Record<string, unknown>[])[0])}
                  onMissing={setUnbound}
                />
              </div>
              <div className="ve-footer">
                <span>Click any text to edit it in place · hover a list for + item · <span className="ve-kbd">Tab</span> next · <span className="ve-kbd">Enter</span> commit · <span className="ve-kbd">Esc</span> cancel</span>
                {unboundChips.length > 0 && (
                  <span className="ve-unbound">
                    <span className="ve-unbound-label">Not rendered, edit in Fields:</span>
                    {unboundChips.map((l) => (
                      <button key={pathLabel(l.path)} className="ve-unbound-chip" onClick={() => switchTab("fields")} title={l.text.slice(0, 120)}>
                        {pathLabel(l.path)}
                      </button>
                    ))}
                  </span>
                )}
              </div>
            </>
          ) : tab === "fields" ? (
            <div className="ve-fields">
              <div className="ve-fields-inner pe-root">
                <div className="pe-component-body">
                  <ComponentFieldEditor
                    comp={comp as ComponentData}
                    onChange={(c) => update(c as Record<string, unknown>)}
                  />
                </div>
              </div>
            </div>
          ) : (
            <YamlPane
              key={yamlSeed}
              initial={yamlSeed.trimEnd()}
              onChange={(text) => { yamlTextRef.current = text; setDirty(true); setError(""); }}
              onSave={() => { void save(); }}
              onEscape={() => { void done(); }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function YamlPane({ initial, onChange, onSave, onEscape }: {
  initial: string;
  onChange: (text: string) => void;
  onSave: () => void;
  onEscape: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const cbRef = useRef({ onChange, onSave, onEscape });
  useEffect(() => { cbRef.current = { onChange, onSave, onEscape }; }, [onChange, onSave, onEscape]);

  useEffect(() => {
    if (!hostRef.current || viewRef.current) return;
    const state = EditorState.create({
      doc: initial,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        yamlLang(),
        EditorView.theme({
          "&": { fontSize: "13px", backgroundColor: "var(--bg)", height: "100%" },
          ".cm-scroller": { overflow: "auto", fontFamily: "'SF Mono', 'Fira Code', Menlo, monospace" },
          ".cm-content": { padding: "12px 0", color: "var(--snow)", caretColor: "var(--teal)" },
          ".cm-cursor": { borderLeftColor: "var(--teal)" },
          ".cm-gutters": { backgroundColor: "var(--bg)", color: "var(--muted)", borderRight: "1px solid var(--border)" },
          ".cm-activeLine": { backgroundColor: "rgba(var(--accent-rgb), 0.06)" },
          ".cm-activeLineGutter": { backgroundColor: "rgba(var(--accent-rgb), 0.08)" },
          ".cm-selectionBackground": { backgroundColor: "rgba(var(--accent-rgb), 0.2) !important" },
        }),
        syntaxHighlighting(HighlightStyle.define([
          { tag: tags.propertyName, color: "var(--teal)" },
          { tag: tags.string, color: "var(--light-muted)" },
          { tag: tags.number, color: "var(--yellow, #E4E6C3)" },
          { tag: tags.bool, color: "var(--yellow, #E4E6C3)" },
          { tag: tags.null, color: "var(--muted)" },
          { tag: tags.comment, color: "var(--muted)", fontStyle: "italic" },
          { tag: tags.punctuation, color: "var(--muted)" },
        ])),
        autocompletion({ icons: false }),
        keymap.of([
          { key: "Mod-s", run: () => { cbRef.current.onSave(); return true; } },
          { key: "Escape", run: () => { cbRef.current.onEscape(); return true; } },
          ...defaultKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) cbRef.current.onChange(u.state.doc.toString());
        }),
      ],
    });
    viewRef.current = new EditorView({ state, parent: hostRef.current });
    viewRef.current.focus();
    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [initial]);

  return <div ref={hostRef} className="ve-yaml" />;
}
