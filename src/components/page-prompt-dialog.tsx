"use client";

import { useCallback, useEffect, useState } from "react";

// Public-page counterpart to the "Connect an agent" dialog. Same shell and
// classes, different contents: no API key is minted or shown, because everything
// it describes is an anonymous fetch of a public page.
//
// Pages that exist to be handed to an agent can set `agent_prompt: open` in their
// YAML to have this open on load.

interface Props {
  title: string;
  description?: string;
  prompt: string;
  markdownUrl: string;
  openByDefault?: boolean;
}

export default function PagePromptDialog({
  title,
  description,
  prompt,
  markdownUrl,
  openByDefault = false,
}: Props) {
  const [open, setOpen] = useState(openByDefault);
  const [copied, setCopied] = useState<"none" | "prompt" | "full" | "failed">("none");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const flash = useCallback((state: "prompt" | "full" | "failed") => {
    setCopied(state);
    setTimeout(() => setCopied("none"), 2000);
  }, []);

  const copyPrompt = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      flash("prompt");
    } catch {
      flash("failed");
    }
  }, [prompt, flash]);

  // For agents with no fetch tool: the prompt plus the page text inlined. The
  // markdown is pulled on click so a long page is not shipped in the HTML.
  const copyWithContent = useCallback(async () => {
    try {
      const response = await fetch(markdownUrl, { headers: { Accept: "text/markdown" } });
      if (!response.ok) throw new Error(`markdown fetch failed: ${response.status}`);
      const markdown = await response.text();
      await navigator.clipboard.writeText(
        `${prompt}\n---\n\nThe page content, in case you cannot fetch it:\n\n${markdown}`,
      );
      flash("full");
    } catch {
      flash("failed");
    }
  }, [markdownUrl, prompt, flash]);

  // Rendered inline rather than portalled: .agent-overlay is position: fixed, so
  // it covers the viewport from here, and no portal means no mount-time state to
  // set in an effect.
  const dialog = (
    <div className="agent-overlay" onClick={() => setOpen(false)}>
      <div
        className="agent-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Use this page with an agent"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="agent-modal-header">
          <h2 className="agent-modal-title">Use this page with an agent</h2>
          <button
            type="button"
            className="agent-modal-close"
            onClick={() => setOpen(false)}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="agent-step">
          <div className="page-prompt-meta">
            <p className="page-prompt-title">{title}</p>
            {description && <p className="agent-step-desc">{description}</p>}
          </div>
          <div className="agent-prompt-header">
            <span className="agent-prompt-label">Paste this into your agent</span>
            <button type="button" className="agent-copy-btn" onClick={copyPrompt}>
              {copied === "prompt" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy prompt"}
            </button>
          </div>
          <pre className="agent-prompt-pre">{prompt}</pre>
          <div className="page-prompt-actions">
            <button type="button" className="agent-copy-btn" onClick={copyWithContent}>
              {copied === "full" ? "Copied with page text" : "Copy with page text"}
            </button>
            <a className="agent-copy-btn" href={markdownUrl}>
              View as markdown
            </a>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="page-agent-actions">
      <button type="button" className="page-agent-action" onClick={() => setOpen(true)}>
        Use with an agent
      </button>
      {open && dialog}
    </div>
  );
}
