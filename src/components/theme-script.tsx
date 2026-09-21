import Script from "next/script";
import { normalizeLegacyTheme } from "@/lib/theme";

interface ThemeProps {
  theme: string;
  mode: string;
  texture?: string;
  glow?: string;
  depth?: string;
}

function resolve({ theme, mode, texture = "none", glow = "none", depth = "soft" }: ThemeProps) {
  const normalized = normalizeLegacyTheme(theme, mode);
  return {
    theme: normalized.theme ?? "violet",
    mode: normalized.mode ?? mode,
    texture,
    glow,
    depth,
  };
}

/** data-* attributes for <html>. The root layout spreads these so the first paint is themed with no script. */
export function themeAttributes(props: ThemeProps): Record<`data-${string}`, string> {
  const t = resolve(props);
  return { "data-theme": t.theme, "data-mode": t.mode, "data-texture": t.texture, "data-glow": t.glow, "data-depth": t.depth };
}

/**
 * Public routes (/p/<org>) live under the root layout but theme by the
 * page's org, not the viewer's, so they override the attributes at runtime.
 * next/script keeps React from treating it as a component-rendered
 * <script>, which it warns about on client re-renders.
 */
export function ThemeScript(props: ThemeProps) {
  const t = resolve(props);
  const code = `(function(){var d=document.documentElement;d.setAttribute("data-theme",${JSON.stringify(t.theme)});d.setAttribute("data-mode",${JSON.stringify(t.mode)});d.setAttribute("data-texture",${JSON.stringify(t.texture)});d.setAttribute("data-glow",${JSON.stringify(t.glow)});d.setAttribute("data-depth",${JSON.stringify(t.depth)});})();`;
  return <Script id={`theme-${t.theme}-${t.mode}-${t.texture}-${t.glow}-${t.depth}`} strategy="afterInteractive">{code}</Script>;
}
