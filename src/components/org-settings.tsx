"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { basePath } from "@/lib/api-fetch";

interface OrgSettingsProps {
  canManage: boolean;
  isPersonalDomain: boolean;
  initial: { name: string; domain: string; slug: string; logoUrl?: string; hasLogo?: boolean };
}

export function OrgSettings({ canManage, isPersonalDomain, initial }: OrgSettingsProps) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [domain, setDomain] = useState(initial.domain);
  const [slug, setSlug] = useState(initial.slug);
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl ?? "");
  const [hasLogo, setHasLogo] = useState(initial.hasLogo ?? false);
  const [logoBusy, setLogoBusy] = useState(false);
  // Bumped on upload so the preview <img> busts its cache.
  const [logoVersion, setLogoVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function uploadLogo(file: File) {
    setLogoBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${basePath}/api/org-settings/logo`, {
        method: "POST",
        body: form,
      });
      if (res.ok) {
        setHasLogo(true);
        setLogoVersion((v) => v + 1);
        router.refresh();
      } else {
        const json = (await res.json()) as { error?: string };
        setError(json.error ?? "Failed to upload logo.");
      }
    } catch {
      setError("Failed to upload logo — check your connection and try again.");
    } finally {
      setLogoBusy(false);
    }
  }

  async function removeLogo() {
    setLogoBusy(true);
    setError(null);
    try {
      const res = await fetch(`${basePath}/api/org-settings/logo`, { method: "DELETE" });
      if (res.ok) {
        setHasLogo(false);
        router.refresh();
      } else {
        const json = (await res.json()) as { error?: string };
        setError(json.error ?? "Failed to remove logo.");
      }
    } catch {
      setError("Failed to remove logo — check your connection and try again.");
    } finally {
      setLogoBusy(false);
    }
  }

  const hasChanges =
    name !== initial.name ||
    (!isPersonalDomain && domain !== initial.domain) ||
    slug !== initial.slug ||
    logoUrl !== (initial.logoUrl ?? "");

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
      const body: Record<string, string> = {};
      if (name !== initial.name) body.name = name.trim();
      if (slug !== initial.slug) body.slug = slug.trim();
      if (!isPersonalDomain && domain !== initial.domain) body.domain = domain.trim();
      if (logoUrl !== (initial.logoUrl ?? "")) body.logoUrl = logoUrl.trim();
      if (Object.keys(body).length === 0) return;
      const res = await fetch(`${basePath}/api/org-settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setSaved(true);
        router.refresh();
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
      <div className="theme-section">
        <label className="theme-section-label" htmlFor="org-logo-file">Logo</label>
        <div className="org-logo-row">
          {hasLogo && (
            // eslint-disable-next-line @next/next/no-img-element -- user-uploaded content served from our own API route
            <img
              src={`${basePath}/api/org-logo?v=${logoVersion}`}
              alt="Current logo"
              className="org-logo-preview"
            />
          )}
          {canManage && (
            <>
              <label className={`org-logo-upload${logoBusy ? " org-logo-upload--busy" : ""}`}>
                {logoBusy ? "Uploading…" : hasLogo ? "Replace" : "Upload image"}
                <input
                  id="org-logo-file"
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  disabled={logoBusy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadLogo(f);
                    e.target.value = "";
                  }}
                  style={{ display: "none" }}
                />
              </label>
              {hasLogo && (
                <button className="org-logo-remove" onClick={removeLogo} disabled={logoBusy}>
                  Remove
                </button>
              )}
            </>
          )}
        </div>
        <span className="theme-saved-msg" style={{ display: "block", marginTop: 4 }}>
          Shown in the sidebar instead of the org name. PNG, JPEG, SVG, or WebP up to 512KB — transparency works best.
        </span>
        {canManage && !hasLogo && (
          <div style={{ marginTop: 8 }}>
            <input
              className="pe-input"
              type="text"
              placeholder="…or paste an image URL (https://example.com/logo.svg)"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              style={{ maxWidth: 300 }}
            />
          </div>
        )}
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
