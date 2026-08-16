"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { basePath } from "@/lib/api-fetch";
import { SettingsSection } from "@/components/settings/settings-section";

interface ConnectKeyRow {
  id: string;
  name: string;
  prefix: string;
}

interface ConnectManagerProps {
  authMode?: string;
  canManageKeys: boolean;
}

function maskedPrefix(prefix: string): string {
  return `${prefix}****`;
}

function buildConfig(mcpUrl: string, headerValue: string | null): string {
  return JSON.stringify(
    {
      mcpServers: {
        curata: {
          type: "url",
          url: mcpUrl,
          ...(headerValue ? { headers: { Authorization: `Bearer ${headerValue}` } } : {}),
        },
      },
    },
    null,
    2
  );
}

/**
 * Connect tab: copy-paste MCP setup for any agent client. OAuth is the
 * primary path (paste the URL, sign in when the client asks). The API key
 * path always renders a `ck_...` placeholder: key values are only ever
 * returned once, at creation (see src/app/api/keys/route.ts GET), so this
 * page cannot show a real one for an existing key. It links to the key
 * management UI instead of rebuilding key creation here.
 */
export function ConnectManager({ authMode, canManageKeys }: ConnectManagerProps) {
  const [keys, setKeys] = useState<ConnectKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedKeyId, setSelectedKeyId] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const mcpUrl = `${baseUrl}${basePath.replace(/\/$/, "")}/api/mcp/stream`;
  const noAuth = authMode === "none";

  const load = useCallback(async () => {
    const res = await fetch(`${basePath}/api/keys`);
    if (res.ok) {
      const data = (await res.json()) as ConnectKeyRow[];
      setKeys(data);
      setSelectedKeyId((prev) => prev || (data[0]?.id ?? ""));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  const copy = useCallback((id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied((c) => (c === id ? null : c)), 2000);
  }, []);

  const selectedKey = keys.find((k) => k.id === selectedKeyId);
  const oauthCommand = `claude mcp add --transport http curata ${mcpUrl}`;
  const keySnippet = buildConfig(mcpUrl, noAuth ? null : "ck_your_api_key_here");

  return (
    <>
      <SettingsSection title="Instance URL" description="The MCP endpoint for this instance.">
        <div className="agent-key-card">
          <code className="agent-key-text">{mcpUrl}</code>
          <button className="agent-copy-btn" onClick={() => copy("url", mcpUrl)}>
            {copied === "url" ? "Copied" : "Copy"}
          </button>
        </div>
      </SettingsSection>

      <SettingsSection
        title="OAuth (recommended)"
        description="claude.ai: Settings -> Connectors -> Add custom connector, paste the URL above, sign in. Claude Code: run this, then authenticate from inside the session with /mcp."
      >
        <div className="agent-prompt-header">
          <span className="agent-prompt-label">claude mcp add</span>
          <button className="agent-copy-btn" onClick={() => copy("oauth", oauthCommand)}>
            {copied === "oauth" ? "Copied" : "Copy"}
          </button>
        </div>
        <pre className="agent-prompt-pre">{oauthCommand}</pre>
      </SettingsSection>

      {noAuth ? (
        <SettingsSection
          title="No auth required"
          description="This instance runs with AUTH_MODE=none. Point any client at the URL above, no key needed."
        >
          {null}
        </SettingsSection>
      ) : (
        <SettingsSection
          title="API key (headless clients)"
          description="For clients without OAuth support: CI, cron jobs, server-side agents."
        >
          {loading ? (
            <div className="members-loading">Loading keys&hellip;</div>
          ) : keys.length > 0 ? (
            <>
              <select
                className="pe-select"
                value={selectedKeyId}
                onChange={(e) => setSelectedKeyId(e.target.value)}
              >
                {keys.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name} ({maskedPrefix(k.prefix)})
                  </option>
                ))}
              </select>
              <p className="agent-step-desc">
                Key values are shown once, at creation. Paste {selectedKey ? selectedKey.name : "your key"}&apos;s value in place of{" "}
                <code>ck_your_api_key_here</code> below.
                {canManageKeys && (
                  <>
                    {" "}
                    <Link href="/settings?tab=api-keys">Manage keys</Link>.
                  </>
                )}
              </p>
            </>
          ) : (
            <p className="agent-step-desc">
              No API keys yet.{" "}
              {canManageKeys ? (
                <Link href="/settings?tab=api-keys">Create one in API Keys</Link>
              ) : (
                "Ask an admin to create one"
              )}
              , then paste it below in place of <code>ck_your_api_key_here</code>.
            </p>
          )}

          <div className="agent-prompt-header">
            <span className="agent-prompt-label">.mcp.json (Claude Code)</span>
            <button className="agent-copy-btn" onClick={() => copy("cc", keySnippet)}>
              {copied === "cc" ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="agent-prompt-pre">{keySnippet}</pre>

          <div className="agent-prompt-header">
            <span className="agent-prompt-label">.cursor/mcp.json (Cursor)</span>
            <button className="agent-copy-btn" onClick={() => copy("cursor", keySnippet)}>
              {copied === "cursor" ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="agent-prompt-pre">{keySnippet}</pre>
        </SettingsSection>
      )}
    </>
  );
}
