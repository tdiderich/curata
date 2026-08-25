"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { yaml as yamlLang } from "@codemirror/lang-yaml";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { autocompletion } from "@codemirror/autocomplete";
import { basePath } from "@/lib/api-fetch";

interface InlineComponentEditorProps {
  slug: string;
  componentId: string;
  componentType: string;
  onClose: () => void;
  onSaved: () => void;
  initialYaml?: string;
  autoTrust?: boolean;
  onLocalSave?: (componentId: string, parsed: Record<string, unknown>) => void;
}

export default function InlineComponentEditor({
  slug,
  componentId,
  componentType,
  onClose,
  onSaved,
  initialYaml,
  autoTrust,
  onLocalSave,
}: InlineComponentEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [loading, setLoading] = useState(initialYaml === undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const hashRef = useRef("");
  const savedYamlRef = useRef(initialYaml ?? "");

  useEffect(() => {
    if (initialYaml !== undefined) return;
    fetch(`${basePath}/api/pages/component-yaml?slug=${encodeURIComponent(slug)}&id=${encodeURIComponent(componentId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          savedYamlRef.current = data.yaml;
          hashRef.current = data.contentHash;
        }
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load component");
        setLoading(false);
      });
  }, [slug, componentId, initialYaml]);

  const save = useCallback(async () => {
    const content = viewRef.current?.state.doc.toString();
    if (!content) return;

    if (onLocalSave) {
      try {
        const yamlMod = await import("js-yaml");
        const parsed = yamlMod.default.load(content) as Record<string, unknown>;
        if (!parsed || typeof parsed !== "object") throw new Error("must be a YAML object");
        onLocalSave(componentId, parsed);
        savedYamlRef.current = content;
        setDirty(false);
        onSaved();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Invalid YAML");
      }
      return;
    }

    setSaving(true);
    setError("");

    try {
      const res = await fetch(`${basePath}/api/pages/component-yaml`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          id: componentId,
          yaml: content,
          expectedHash: hashRef.current,
          autoTrust,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        hashRef.current = data.contentHash;
        savedYamlRef.current = content;
        setDirty(false);
        setSaving(false);
        onSaved();
        return;
      }

      const data = await res.json();
      setError(data.error || "Save failed");
    } catch {
      setError("Network error");
    }
    setSaving(false);
  }, [slug, componentId, onSaved, onLocalSave]);

  useEffect(() => {
    if (loading || !editorRef.current || viewRef.current) return;

    const state = EditorState.create({
      doc: savedYamlRef.current,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        yamlLang(),
        EditorView.theme({
          "&": { fontSize: "13px", backgroundColor: "var(--bg)" },
          ".cm-scroller": { overflow: "auto", fontFamily: "'SF Mono', 'Fira Code', Menlo, monospace" },
          ".cm-content": { padding: "8px 0", color: "var(--snow)", caretColor: "var(--teal)" },
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
          { key: "Mod-s", run: () => { save(); return true; } },
          { key: "Escape", run: () => { onClose(); return true; } },
          ...defaultKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            setDirty(true);
            setError("");
          }
        }),
      ],
    });

    viewRef.current = new EditorView({ state, parent: editorRef.current });

    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [loading, save, onClose]);

  if (loading) {
    return (
      <div className="component-editor-overlay" onClick={onClose}>
        <div className="component-editor-modal" onClick={(e) => e.stopPropagation()}>
          <div className="inline-editor-loading">Loading component...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="component-editor-overlay" onClick={async () => {
      if (dirty) await save();
      onClose();
    }}>
      <div className="component-editor-modal" onClick={(e) => e.stopPropagation()}>
        <div className="inline-editor-header">
          <span className="inline-editor-type">{componentType}</span>
          <span className="inline-editor-id">{componentId}</span>
          <div className="inline-editor-spacer" />
          {error && <span className="inline-editor-error">{error}</span>}
          {dirty && (
            <button
              className="inline-editor-btn inline-editor-btn--discard"
              onClick={() => {
                const view = viewRef.current;
                if (!view) return;
                view.dispatch({
                  changes: { from: 0, to: view.state.doc.length, insert: savedYamlRef.current },
                });
                setDirty(false);
                setError("");
              }}
            >
              Discard
            </button>
          )}
          <button
            className="inline-editor-btn inline-editor-btn--save"
            disabled={!dirty || saving}
            onClick={save}
          >
            {saving ? "Saving..." : "Save"}
          </button>
          <button
            className="inline-editor-btn inline-editor-btn--close"
            onClick={async () => {
              if (dirty) await save();
              onClose();
            }}
          >
            Done
          </button>
        </div>
        <div ref={editorRef} className="inline-editor-cm" />
      </div>
    </div>
  );
}
