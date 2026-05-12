import { normalizeLegacyTheme } from "@/lib/theme";

export function ThemeScript({
  theme,
  mode,
  texture = "none",
  glow = "none",
}: {
  theme: string;
  mode: string;
  texture?: string;
  glow?: string;
}) {
  const normalized = normalizeLegacyTheme(theme, mode);
  const effectiveTheme = normalized.theme ?? "violet";
  const effectiveMode = normalized.mode ?? mode;

  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `(function(){var d=document.documentElement;d.setAttribute("data-theme",${JSON.stringify(effectiveTheme)});d.setAttribute("data-mode",${JSON.stringify(effectiveMode)});d.setAttribute("data-texture",${JSON.stringify(texture)});d.setAttribute("data-glow",${JSON.stringify(glow)});})();`,
      }}
    />
  );
}
