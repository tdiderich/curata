"use client";

import { useState, useCallback } from "react";
import { buildAgentPrompt } from "@/lib/agent-prompt";

interface AgentConnectFlowProps {
  slug?: string;
  temporary?: boolean;
}

export function AgentConnectFlow({ slug, temporary }: AgentConnectFlowProps) {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const prompt = apiKey ? buildAgentPrompt({ baseUrl, token: apiKey, slug }) : "";

  const handleGenerate = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: slug ? `agent:${slug}` : "agent",
          expiresIn: temporary ? "1h" : "never",
        }),
      });
      const data = await res.json() as { key?: string; error?: string };
      if (data.key) {
        setApiKey(data.key);
      }
    } finally {
      setLoading(false);
    }
  }, [slug, temporary]);

  const copyPrompt = useCallback(() => {
    navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [prompt]);

  if (!apiKey) {
    return (
      <div className="agent-step">
        <p className="agent-step-desc">
          Generate {temporary ? "a temporary " : "an "}API key and get a ready-to-paste prompt for your agent.
          {temporary && " This key expires in 1 hour."}
        </p>
        <button
          className="agent-btn-primary"
          onClick={handleGenerate}
          disabled={loading}
        >
          {loading ? "Generating…" : "Generate API key"}
        </button>
      </div>
    );
  }

  return (
    <div className="agent-step">
      {temporary && (
        <div className="agent-warning">
          This key expires in 1 hour. Create a long-lived key in Settings for ongoing access.
        </div>
      )}
      <div className="agent-prompt-header">
        <span className="agent-prompt-label">Paste this into your agent</span>
        <button className="agent-copy-btn" onClick={copyPrompt}>
          {copied ? "Copied" : "Copy prompt"}
        </button>
      </div>
      <pre className="agent-prompt-pre">{prompt}</pre>
    </div>
  );
}
