"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { basePath } from "@/lib/api-fetch";

interface ContentRule {
  id: string;
  text: string;
  mode: "warn" | "block";
  patterns?: string[];
}

interface ContentRulesEditorProps {
  scopeParam: string;
  initialRules: ContentRule[];
  canManage: boolean;
}

function PatternPills({
  patterns,
  onChange,
}: {
  patterns: string[];
  onChange: (patterns: string[]) => void;
}) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function addPattern() {
    const trimmed = input.trim();
    if (!trimmed || patterns.includes(trimmed)) return;
    onChange([...patterns, trimmed]);
    setInput("");
  }

  function removePattern(idx: number) {
    onChange(patterns.filter((_, i) => i !== idx));
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      addPattern();
    }
    if (e.key === "Backspace" && !input && patterns.length > 0) {
      removePattern(patterns.length - 1);
    }
  }

  return (
    <div className="pattern-pills-wrap" onClick={() => inputRef.current?.focus()}>
      {patterns.map((p, i) => (
        <span key={i} className="pattern-pill">
          <code>{p}</code>
          <button
            className="pattern-pill-x"
            onClick={(e) => { e.stopPropagation(); removePattern(i); }}
            tabIndex={-1}
          >
            x
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        className="pattern-pills-input"
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => { if (input.trim()) addPattern(); }}
        placeholder={patterns.length === 0 ? "Type regex, press Enter" : ""}
      />
    </div>
  );
}

export function ContentRulesEditor({ scopeParam, initialRules, canManage }: ContentRulesEditorProps) {
  const router = useRouter();
  const [rules, setRules] = useState<ContentRule[]>(initialRules);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inlineText, setInlineText] = useState("");
  const inlineRef = useRef<HTMLInputElement>(null);

  const [formText, setFormText] = useState("");
  const [formMode, setFormMode] = useState<"warn" | "block">("warn");
  const [formPatterns, setFormPatterns] = useState<string[]>([]);

  function resetForm() {
    setFormText("");
    setFormMode("warn");
    setFormPatterns([]);
    setEditingId(null);
  }

  function startEdit(rule: ContentRule) {
    setEditingId(rule.id);
    setFormText(rule.text);
    setFormMode(rule.mode);
    setFormPatterns(rule.patterns || []);
    setExpandedId(rule.id);
  }

  function toggleExpand(id: string) {
    if (editingId === id) return;
    setExpandedId(expandedId === id ? null : id);
  }

  async function saveRule() {
    if (!formText.trim()) return;
    setBusy(true);
    setError(null);

    const mode = formPatterns.length > 0 ? formMode : "warn";
    const body: Record<string, unknown> = {
      text: formText.trim(),
      mode,
    };
    if (formPatterns.length > 0) body.patterns = formPatterns;

    try {
      if (editingId) {
        body.id = editingId;
        const res = await fetch(`${basePath}/api/rules?${scopeParam}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const json = await res.json() as { error?: string };
          setError(json.error || "Failed to update rule.");
          return;
        }
        const data = await res.json() as { rule: ContentRule };
        setRules((prev) => prev.map((r) => r.id === editingId ? data.rule : r));
      } else {
        const res = await fetch(`${basePath}/api/rules?${scopeParam}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const json = await res.json() as { error?: string };
          setError(json.error || "Failed to add rule.");
          return;
        }
        const data = await res.json() as { rule: ContentRule };
        setRules((prev) => [...prev, data.rule]);
      }
      resetForm();
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function inlineAdd() {
    const text = inlineText.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${basePath}/api/rules?${scopeParam}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, mode: "warn" }),
      });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        setError(json.error || "Failed to add rule.");
        return;
      }
      const data = await res.json() as { rule: ContentRule };
      setRules((prev) => [...prev, data.rule]);
      setInlineText("");
      router.refresh();
      inlineRef.current?.focus();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteRule(ruleId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${basePath}/api/rules?${scopeParam}&ruleId=${ruleId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        setError(json.error || "Failed to delete rule.");
        return;
      }
      setRules((prev) => prev.filter((r) => r.id !== ruleId));
      if (editingId === ruleId) resetForm();
      if (expandedId === ruleId) setExpandedId(null);
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function loadDefaults() {
    if (!confirm("Load recommended content rules? Existing rules with the same ID will be replaced.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${basePath}/api/rules/defaults?${scopeParam}`, { method: "POST" });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        setError(json.error || "Failed to load defaults.");
        return;
      }
      const data = await res.json() as { rules: ContentRule[] };
      setRules(data.rules);
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  const isExpanded = (id: string) => expandedId === id;
  const isEditing = (id: string) => editingId === id;

  return (
    <div className="cr-editor">
      {error && <div className="cr-error">{error}</div>}

      {rules.length === 0 && (
        <div className="cr-empty">No content rules configured.</div>
      )}

      <div className="cr-list">
        {rules.map((rule) => (
          <div key={rule.id} className={`cr-row${isExpanded(rule.id) ? " cr-row--expanded" : ""}`}>
            <div className="cr-row-summary" onClick={() => toggleExpand(rule.id)}>
              <span className={`cr-dot cr-dot--${rule.mode}`} />
              <span className="cr-row-text">{rule.text}</span>
              <span className="cr-row-meta">
                {rule.patterns?.length
                  ? <span className="cr-chip cr-chip--enforced">{rule.patterns.length} pattern{rule.patterns.length !== 1 ? "s" : ""}</span>
                  : <span className="cr-chip cr-chip--guidance">guidance</span>
                }
              </span>
              {canManage && (
                <span className="cr-row-actions">
                  <button onClick={(e) => { e.stopPropagation(); startEdit(rule); }}>Edit</button>
                  <button className="cr-row-delete" onClick={(e) => { e.stopPropagation(); deleteRule(rule.id); }}>Delete</button>
                </span>
              )}
            </div>

            {isExpanded(rule.id) && (
              <div className="cr-detail">
                {isEditing(rule.id) ? (
                  <div className="cr-edit-form">
                    <textarea
                      className="pe-input cr-edit-text"
                      value={formText}
                      onChange={(e) => setFormText(e.target.value)}
                      rows={2}
                    />
                    <label className="cr-field-label">
                      Regex patterns
                      <span className="cr-field-hint">Content matching any pattern triggers this rule on save</span>
                    </label>
                    <PatternPills patterns={formPatterns} onChange={(p) => {
                      setFormPatterns(p);
                      if (p.length === 0) setFormMode("warn");
                    }} />
                    {formPatterns.length > 0 && (
                      <div className="cr-mode-row">
                        <select
                          className="pe-input cr-mode-select"
                          value={formMode}
                          onChange={(e) => setFormMode(e.target.value as "warn" | "block")}
                        >
                          <option value="warn">Warn</option>
                          <option value="block">Block</option>
                        </select>
                        <span className="cr-mode-hint">
                          {formMode === "block" ? "Saves with matches will be rejected" : "Matches flagged but save allowed"}
                        </span>
                      </div>
                    )}
                    <div className="cr-edit-actions">
                      <button className="cr-save-btn" onClick={saveRule} disabled={busy || !formText.trim()}>
                        {busy ? "Saving..." : "Save"}
                      </button>
                      <button className="cr-cancel-btn" onClick={() => { resetForm(); setExpandedId(null); }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="cr-detail-view">
                    {rule.patterns && rule.patterns.length > 0 ? (
                      <>
                        <div className="cr-detail-label">
                          {rule.mode === "block" ? "Blocks saves matching:" : "Warns on saves matching:"}
                        </div>
                        <div className="cr-detail-patterns">
                          {rule.patterns.map((p, i) => (
                            <code key={i} className="cr-pattern-chip">{p}</code>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="cr-detail-label">
                        Guidance only. Shown to agents on read, not enforced on save.
                        {canManage && " Edit to add regex patterns for enforcement."}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {canManage && (
        <div className="cr-bottom">
          <div className="cr-inline-add">
            <input
              ref={inlineRef}
              className="cr-inline-input"
              type="text"
              value={inlineText}
              onChange={(e) => setInlineText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); inlineAdd(); } }}
              placeholder="Type a rule, press Enter"
              disabled={busy}
            />
          </div>
          <button className="cr-defaults-btn" onClick={loadDefaults} disabled={busy}>
            Load Recommended
          </button>
        </div>
      )}
    </div>
  );
}
