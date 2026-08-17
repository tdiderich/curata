"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { basePath } from "@/lib/api-fetch";
import { SegmentedControl } from "@/components/settings/segmented-control";

function normalizeLegacyTheme(
  theme: string | null,
  mode: string | null
): { theme: string | null; mode: string | null } {
  if (theme === "dark" || theme === "light") return { theme: null, mode: theme };
  return { theme, mode };
}

const COLORS = [
  { value: "red", label: "Red", color: "#BB7777" },
  { value: "orange", label: "Orange", color: "#BB8C66" },
  { value: "yellow", label: "Yellow", color: "#B8A866" },
  { value: "green", label: "Green", color: "#7A9878" },
  { value: "teal", label: "Teal", color: "#3CCECE" },
  { value: "blue", label: "Blue", color: "#7897B8" },
  { value: "indigo", label: "Indigo", color: "#8A7FBB" },
  { value: "violet", label: "Violet", color: "#AB7FBB" },
];

const TEXTURES = [
  { value: "none", label: "None" },
  { value: "dots", label: "Dots" },
  { value: "grid", label: "Grid" },
  { value: "grain", label: "Grain" },
  { value: "topography", label: "Topo" },
  { value: "diagonal", label: "Diagonal" },
];

const GLOWS = [
  { value: "none", label: "None" },
  { value: "accent", label: "Accent" },
  { value: "corner", label: "Corner" },
];

interface ThemeSettingsProps {
  canManage: boolean;
  initial: {
    theme: string;
    mode: string;
    texture: string;
    glow: string;
  };
}

export function ThemeSettings({ canManage, initial }: ThemeSettingsProps) {
  const router = useRouter();
  const { theme: normalizedTheme, mode: normalizedMode } = normalizeLegacyTheme(initial.theme, initial.mode);
  const initColor = normalizedTheme ?? "violet";
  const initMode = normalizedMode ?? initial.mode;
  const [color, setColor] = useState(initColor);
  const [mode, setMode] = useState(initMode);
  const [texture, setTexture] = useState(initial.texture);
  const [glow, setGlow] = useState(initial.glow);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = document.documentElement;
    d.setAttribute("data-theme", color);
    d.setAttribute("data-mode", mode);
    d.setAttribute("data-texture", texture);
    d.setAttribute("data-glow", glow);
  }, [color, mode, texture, glow]);

  const hasChanges =
    color !== initColor ||
    mode !== initMode ||
    texture !== initial.texture ||
    glow !== initial.glow;

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch(`${basePath}/api/org-settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: color, mode, texture, glow }),
      });
      if (res.ok) {
        setSaved(true);
        router.refresh();
        setTimeout(() => setSaved(false), 2000);
      } else {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setError(json.error ?? "Failed to save theme");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="theme-settings">
      <div className="theme-section">
        <span className="theme-section-label">Mode</span>
        <SegmentedControl<string>
          value={mode}
          onChange={setMode}
          disabledOptions={canManage ? [] : ["dark", "light"]}
          options={[
            { value: "dark", label: "Dark" },
            { value: "light", label: "Light" },
          ]}
        />
      </div>

      <div className="theme-section">
        <span className="theme-section-label">Accent color</span>
        <div className="theme-swatches">
          {COLORS.map((c) => (
            <button
              key={c.value}
              className={`theme-swatch ${color === c.value ? "theme-swatch--active" : ""}`}
              style={{ "--swatch-color": c.color } as React.CSSProperties}
              onClick={() => canManage && setColor(c.value)}
              disabled={!canManage}
              title={c.label}
            >
              <span className="theme-swatch-dot" />
              <span className="theme-swatch-label">{c.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="theme-section">
        <span className="theme-section-label">Background texture</span>
        <SegmentedControl<string>
          value={texture}
          onChange={setTexture}
          disabledOptions={canManage ? [] : TEXTURES.map((t) => t.value)}
          options={TEXTURES}
        />
      </div>

      <div className="theme-section">
        <span className="theme-section-label">Header glow</span>
        <SegmentedControl<string>
          value={glow}
          onChange={setGlow}
          disabledOptions={canManage ? [] : GLOWS.map((g) => g.value)}
          options={GLOWS}
        />
      </div>

      {error && (
        <div style={{ color: "var(--color-error, #f87171)", marginBottom: 8, fontSize: 13 }}>
          {error}
        </div>
      )}
      {canManage && (
        <div className="theme-actions">
          <button
            className="btn btn--primary"
            onClick={save}
            disabled={!hasChanges || saving}
          >
            {saving ? "Saving..." : saved ? "Saved" : "Save theme"}
          </button>
          {saved && <span className="theme-saved-msg">Theme applied to all pages</span>}
        </div>
      )}
    </div>
  );
}
