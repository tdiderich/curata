"use client";

import { useState } from "react";
import { basePath } from "@/lib/api-fetch";

interface OrgSettingsProps {
  canManage: boolean;
  isPersonalDomain: boolean;
  initial: { name: string; domain: string; slug: string };
}

export function OrgSettings({ canManage, isPersonalDomain, initial }: OrgSettingsProps) {
  const [name, setName] = useState(initial.name);
  const [domain, setDomain] = useState(initial.domain);
  const [slug, setSlug] = useState(initial.slug);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasChanges =
    name !== initial.name ||
    (!isPersonalDomain && domain !== initial.domain) ||
    slug !== initial.slug;

  const slugPattern = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$|^[a-z0-9]{3,40}$/;

  async function save() {
    if (!name.trim()) return;
    if (slug && !slugPattern.test(slug)) {
      setError("Slug must be 3-40 chars, lowercase letters, numbers, and hyphens only.");
      return;
    }
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const body: Record<string, string> = { name: name.trim(), slug: slug.trim() };
      if (!isPersonalDomain) {
        body.domain = domain.trim();
      }
      const res = await fetch(`${basePath}/api/org-settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } else {
        const json = (await res.json()) as { error?: string };
        setError(json.error ?? "Failed to save settings.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="theme-settings">
      <div className="theme-section">
        <label className="theme-section-label" htmlFor="org-name">Name</label>
        <input
          id="org-name"
          className="pe-input"
          type="text"
          value={name}
          onChange={(e) => canManage && setName(e.target.value)}
          disabled={!canManage}
          style={{ maxWidth: 300 }}
        />
      </div>
      <div className="theme-section">
        <label className="theme-section-label" htmlFor="org-slug">Slug</label>
        <input
          id="org-slug"
          className="pe-input"
          type="text"
          value={slug}
          onChange={(e) => canManage && setSlug(e.target.value.toLowerCase())}
          disabled={!canManage}
          style={{ maxWidth: 300 }}
        />
        <span className="theme-saved-msg" style={{ display: "block", marginTop: 4 }}>
          Used in URLs. Lowercase letters, numbers, and hyphens only (3–40 chars).
        </span>
      </div>
      {!isPersonalDomain && (
        <div className="theme-section">
          <label className="theme-section-label" htmlFor="org-domain">
            Auto-join domain
          </label>
          <input
            id="org-domain"
            className="pe-input"
            type="text"
            placeholder="e.g. acme.com"
            value={domain}
            onChange={(e) => canManage && setDomain(e.target.value.toLowerCase())}
            disabled={!canManage}
            style={{ maxWidth: 300 }}
          />
          <span className="theme-saved-msg" style={{ display: "block", marginTop: 4 }}>
            Users with this email domain will auto-join your org
          </span>
        </div>
      )}
      {error && (
        <div style={{ color: "var(--color-error, #f87171)", marginBottom: 8, fontSize: 13 }}>
          {error}
        </div>
      )}
      {canManage && (
        <div className="theme-actions">
          <button
            className="theme-save-btn"
            onClick={save}
            disabled={!hasChanges || saving || !name.trim()}
          >
            {saving ? "Saving..." : saved ? "Saved" : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}
