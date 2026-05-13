"use client";

import { useState, useEffect } from "react";
import { normalizeLegacyTheme } from "@/lib/theme";
import { basePath } from "@/lib/api-fetch";

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
  const initColor = ["dark", "light"].includes(initial.theme) ? "violet" : initial.theme;
  const initMode = ["dark", "light"].includes(initial.theme) ? initial.theme : initial.mode;
  const [color, setColor] = useState(initColor);
  const [mode, setMode] = useState(initMode);
  const [texture, setTexture] = useState(initial.texture);
  const [glow, setGlow] = useState(initial.glow);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

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
    try {
      const res = await fetch(`${basePath}/api/org-settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: color, mode, texture, glow }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="theme-settings">
      <div className="theme-section">
        <span className="theme-section-label">Mode</span>
        <div className="theme-toggle-group">
          <button
            className={`theme-toggle ${mode === "dark" ? "theme-toggle--active" : ""}`}
            onClick={() => canManage && setMode("dark")}
            disabled={!canManage}
          >
            Dark
          </button>
          <button
            className={`theme-toggle ${mode === "light" ? "theme-toggle--active" : ""}`}
            onClick={() => canManage && setMode("light")}
            disabled={!canManage}
          >
            Light
          </button>
        </div>
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
        <div className="theme-toggle-group">
          {TEXTURES.map((t) => (
            <button
              key={t.value}
              className={`theme-toggle ${texture === t.value ? "theme-toggle--active" : ""}`}
              onClick={() => canManage && setTexture(t.value)}
              disabled={!canManage}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="theme-section">
        <span className="theme-section-label">Header glow</span>
        <div className="theme-toggle-group">
          {GLOWS.map((g) => (
            <button
              key={g.value}
              className={`theme-toggle ${glow === g.value ? "theme-toggle--active" : ""}`}
              onClick={() => canManage && setGlow(g.value)}
              disabled={!canManage}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {canManage && (
        <div className="theme-actions">
          <button
            className="theme-save-btn"
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
