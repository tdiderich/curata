"use client";

import { useState } from "react";
import { AgentConnectFlow } from "./agent-connect-flow";
import { STARTER_PROMPT, mcpAddCommand } from "@/lib/starter-prompt";
import { trackClient } from "@/lib/analytics-client";

interface AgentConnectModalProps {
  slug: string;
  onClose: () => void;
  authMode?: string;
}

function CopyRow({ step, label, value, id }: { step: number; label: string; value: string; id: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      trackClient("connect_copy", { what: id });
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="quickstart-row">
      <div className="quickstart-row-head">
        <span className="quickstart-step">{step}</span>
        <span className="quickstart-label">{label}</span>
        <button type="button" className="btn btn--ghost quickstart-copy" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="quickstart-value">{value}</pre>
    </div>
  );
}

export default function AgentConnectModal({ slug, onClose, authMode }: AgentConnectModalProps) {
  const [showOther, setShowOther] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return (
    <div className="agent-overlay" onClick={onClose}>
      <div className="agent-modal" onClick={(e) => e.stopPropagation()}>
        <div className="agent-modal-header">
          <span className="agent-modal-title">Connect an agent</span>
          <button className="agent-modal-close" onClick={onClose}>
            &#x2715;
          </button>
        </div>
        <div className="quickstart">
          <CopyRow step={1} id="mcp-add" label="Add curata to Claude Code" value={mcpAddCommand(origin)} />
          <CopyRow step={2} id="starter-prompt" label="Then ask it to set up your brain" value={STARTER_PROMPT} />
          <button type="button" className="quickstart-other" onClick={() => setShowOther((v) => !v)} aria-expanded={showOther}>
            {showOther ? "Hide" : "Using another agent?"} {showOther ? "▴" : "▾"}
          </button>
        </div>
        {showOther && <AgentConnectFlow slug={slug} temporary authMode={authMode} />}
      </div>
    </div>
  );
}
