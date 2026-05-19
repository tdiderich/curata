"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { yaml as yamlLang } from "@codemirror/lang-yaml";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { basePath } from "@/lib/api-fetch";

export default function SourceEditor({ slug, onSaved }: { slug: string; onSaved?: () => void }) {
  const router = useRouter();
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const yamlRef = useRef("");
  const [yamlContent, setYamlContent] = useState("");
  const [hash, setHash] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    fetch(`${basePath}/api/pages/yaml?slug=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          setYamlContent(data.yaml);
          yamlRef.current = data.yaml;
          setHash(data.contentHash);
        }
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load page source");
        setLoading(false);
      });
  }, [slug]);

  const save = useCallback(async () => {
    const content = viewRef.current?.state.doc.toString() ?? yamlRef.current;
    setSaving(true);
    setError("");

    try {
      let currentHash = hash;
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await fetch(`${basePath}/api/pages/yaml`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug, yaml: content, expectedHash: currentHash }),
        });

        if (res.ok) {
          const data = await res.json();
          setHash(data.contentHash);
          setDirty(false);
          setSaving(false);
          router.refresh();
          onSaved?.();
          return;
        }

        if (res.status === 409 && attempt === 0) {
          const latest = await fetch(
            `${basePath}/api/pages/yaml?slug=${encodeURIComponent(slug)}`,
          );
          if (latest.ok) {
            const data = await latest.json();
            currentHash = data.contentHash;
            setHash(currentHash);
            continue;
          }
        }

        const data = await res.json();
        setError(data.error || "Save failed");
        setSaving(false);
        return;
      }
    } catch {
      setError("Network error");
      setSaving(false);
    }
  }, [slug, hash, router]);

  // Initialize CodeMirror
  useEffect(() => {
    if (loading || !editorRef.current || viewRef.current) return;

    const saveKeymap = keymap.of([{
      key: "Mod-s",
      run: () => {
        // Save triggers via the button/keyboard handler; CM just prevents default
        document.dispatchEvent(new CustomEvent("source-editor-save"));
        return true;
      },
    }]);

    const state = EditorState.create({
      doc: yamlRef.current,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        yamlLang(),
        EditorView.theme({
          "&": { height: "100%", fontSize: "13px", backgroundColor: "var(--bg)" },
          ".cm-scroller": { overflow: "auto", fontFamily: "'SF Mono', 'Fira Code', 'Fira Mono', Menlo, monospace" },
          ".cm-content": { padding: "8px 0", color: "var(--snow)", caretColor: "var(--teal)" },
          ".cm-cursor": { borderLeftColor: "var(--teal)" },
          ".cm-gutters": { backgroundColor: "var(--bg)", color: "var(--muted)", borderRight: "1px solid var(--border)" },
          ".cm-activeLineGutter": { backgroundColor: "rgba(var(--accent-rgb), 0.08)" },
          ".cm-activeLine": { backgroundColor: "rgba(var(--accent-rgb), 0.06)" },
          ".cm-selectionBackground": { backgroundColor: "rgba(var(--accent-rgb), 0.2) !important" },
          "&.cm-focused .cm-selectionBackground": { backgroundColor: "rgba(var(--accent-rgb), 0.25) !important" },
          ".cm-matchingBracket": { backgroundColor: "rgba(var(--accent-rgb), 0.3)", color: "var(--snow) !important" },
          ".cm-searchMatch": { backgroundColor: "rgba(var(--accent-rgb), 0.3)" },
          ".cm-searchMatch-selected": { backgroundColor: "rgba(var(--accent-rgb), 0.5)" },
          ".cm-panels": { backgroundColor: "var(--bg)", color: "var(--snow)" },
          ".cm-panels input": { backgroundColor: "var(--bg)", color: "var(--snow)", border: "1px solid var(--border)" },
          ".cm-panels button": { backgroundColor: "var(--surface)", color: "var(--snow)", border: "1px solid var(--border)" },
        }),
        syntaxHighlighting(HighlightStyle.define([
          { tag: tags.propertyName, color: "var(--teal)" },
          { tag: tags.string, color: "var(--light-muted)" },
          { tag: tags.number, color: "var(--yellow, #E4E6C3)" },
          { tag: tags.bool, color: "var(--yellow, #E4E6C3)" },
          { tag: tags.null, color: "var(--muted)" },
          { tag: tags.comment, color: "var(--muted)", fontStyle: "italic" },
          { tag: tags.keyword, color: "var(--teal)" },
          { tag: tags.operator, color: "var(--light-muted)" },
          { tag: tags.punctuation, color: "var(--muted)" },
        ])),
        highlightSelectionMatches(),
        saveKeymap,
        keymap.of([...defaultKeymap, ...searchKeymap, indentWithTab]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            yamlRef.current = update.state.doc.toString();
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
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cmd+S handler (from CodeMirror dispatch or keyboard)
  useEffect(() => {
    function handleSave() {
      if (dirty && !saving) save();
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "s" && (e.metaKey || e.ctrlKey) && !e.target?.toString().includes("cm-content")) {
        e.preventDefault();
        handleSave();
      }
    }
    document.addEventListener("source-editor-save", handleSave);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("source-editor-save", handleSave);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [dirty, saving, save]);

  if (loading) {
    return <div className="source-editor-loading">Loading source…</div>;
  }

  return (
    <div className="source-editor">
      <div className="source-editor-toolbar">
        <span className="source-editor-label">YAML Source</span>
        {dirty && <span className="source-editor-dirty">unsaved</span>}
        <div className="source-editor-spacer" />
        {error && <span className="source-editor-error">{error}</span>}
        <button
          className={`source-editor-save${dirty ? " source-editor-save--dirty" : ""}`}
          disabled={!dirty || saving}
          onClick={save}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      <div ref={editorRef} className="source-editor-cm" />
    </div>
  );
}
