"use client";

import { useState, useEffect, useCallback } from "react";

interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string | null;
}

interface NewKeyResult {
  key: string;
  prefix: string;
  expiresAt: string | null;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function maskedPrefix(prefix: string): string {
  return `${prefix}****`;
}

export function ApiKeyManager() {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [expiresIn, setExpiresIn] = useState("never");
  const [creating, setCreating] = useState(false);

  const [newKey, setNewKey] = useState<NewKeyResult | null>(null);
  const [keyCopied, setKeyCopied] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/keys");
    if (res.ok) {
      const data = (await res.json()) as ApiKeyRow[];
      setKeys(data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), expiresIn }),
      });
      const data = (await res.json()) as { key?: string; prefix?: string; expiresAt?: string | null; error?: string };
      if (data.key && data.prefix) {
        setNewKey({ key: data.key, prefix: data.prefix, expiresAt: data.expiresAt ?? null });
        setName("");
        setExpiresIn("never");
        await load();
      }
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    setBusy(id);
    try {
      await fetch("/api/keys", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      await load();
      if (newKey) {
        const revokedKey = keys.find((k) => k.id === id);
        if (revokedKey && newKey.prefix === revokedKey.prefix) {
          setNewKey(null);
        }
      }
    } finally {
      setBusy(null);
    }
  }

  function copyNewKey() {
    if (!newKey) return;
    navigator.clipboard.writeText(newKey.key);
    setKeyCopied(true);
    setTimeout(() => setKeyCopied(false), 2000);
  }

  return (
    <div className="key-manager">
      <div className="key-create-form">
        <input
          className="pe-input key-create-name"
          type="text"
          placeholder="Key name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") create(); }}
        />
        <select
          className="pe-select key-create-expires"
          value={expiresIn}
          onChange={(e) => setExpiresIn(e.target.value)}
        >
          <option value="never">Never</option>
          <option value="1h">1 hour</option>
          <option value="24h">24 hours</option>
          <option value="7d">7 days</option>
          <option value="30d">30 days</option>
        </select>
        <button
          className="agent-btn-primary"
          onClick={create}
          disabled={creating || !name.trim()}
        >
          {creating ? "Creating…" : "Create key"}
        </button>
      </div>

      {newKey && (
        <div className="key-new-reveal">
          <div className="agent-warning">
            This key will not be shown again. Copy it now.
          </div>
          <div className="agent-key-card">
            <code className="agent-key-text">{newKey.key}</code>
            <button className="agent-copy-btn" onClick={copyNewKey}>
              {keyCopied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="members-loading">Loading keys&hellip;</div>
      ) : keys.length === 0 ? (
        <div className="dash-empty">No active keys.</div>
      ) : (
        <table className="dash-table">
          <thead>
            <tr>
              <th className="dash-th dash-th-title">Name</th>
              <th className="dash-th">Prefix</th>
              <th className="dash-th">Scopes</th>
              <th className="dash-th">Created</th>
              <th className="dash-th">Expires</th>
              <th className="dash-th dash-th-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} className="dash-row">
                <td className="dash-td dash-td-title">{k.name}</td>
                <td className="dash-td">
                  <code className="key-prefix">{maskedPrefix(k.prefix)}</code>
                </td>
                <td className="dash-td dash-td-muted">{k.scopes.join(", ")}</td>
                <td className="dash-td dash-td-muted">{formatDate(k.createdAt)}</td>
                <td className="dash-td dash-td-muted">
                  {k.expiresAt ? formatDate(k.expiresAt) : "Never"}
                </td>
                <td className="dash-td dash-td-right">
                  <button
                    className="members-remove-btn"
                    onClick={() => revoke(k.id)}
                    disabled={busy === k.id}
                  >
                    {busy === k.id ? "..." : "Revoke"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
