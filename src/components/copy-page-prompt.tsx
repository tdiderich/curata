"use client";

import { useState } from "react";

// Fallback path for handing a page to an agent: copies the page as markdown with
// a short provenance preamble. Fetching the .md URL is the better route when the
// receiving agent can reach the network; this covers agents with no fetch tool,
// and pages behind a share link the agent cannot follow.
//
// The markdown is fetched on click rather than embedded in the HTML, so a long
// page does not ship its whole body twice.

interface Props {
  markdownUrl: string;
  preamble: string;
}

type State = "idle" | "working" | "copied" | "failed";

export default function CopyPagePrompt({ markdownUrl, preamble }: Props) {
  const [state, setState] = useState<State>("idle");

  async function copy() {
    setState("working");
    try {
      const response = await fetch(markdownUrl, { headers: { Accept: "text/markdown" } });
      if (!response.ok) throw new Error(`markdown fetch failed: ${response.status}`);
      const markdown = await response.text();
      await navigator.clipboard.writeText(`${preamble}\n\n${markdown}`);
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2000);
  }

  const label =
    state === "working"
      ? "Copying…"
      : state === "copied"
        ? "Copied"
        : state === "failed"
          ? "Copy failed"
          : "Copy as prompt";

  return (
    <div className="page-agent-actions">
      <button
        type="button"
        className="page-agent-action"
        onClick={copy}
        disabled={state === "working"}
        aria-live="polite"
        title="Copy this page as markdown, ready to paste into an agent"
      >
        {label}
      </button>
      <a className="page-agent-action" href={markdownUrl} title="Read this page as markdown">
        View as markdown
      </a>
    </div>
  );
}
