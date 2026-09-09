import { db } from "@/lib/db";

export interface OrgTheme {
  theme: string;
  mode: string;
  texture: string;
  glow: string;
  depth: string;
}

export async function getOrgTheme(orgId: string): Promise<OrgTheme> {
  const defaults: OrgTheme = { theme: "dark", mode: "dark", texture: "none", glow: "none", depth: "soft" };
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { theme: true, mode: true, texture: true, glow: true, depth: true },
  });
  if (!org) return defaults;
  return { theme: org.theme, mode: org.mode, texture: org.texture, glow: org.glow, depth: org.depth };
}

export function normalizeLegacyTheme(
  theme: string | null,
  mode: string | null
): { theme: string | null; mode: string | null } {
  if (theme === "dark" || theme === "light") return { theme: null, mode: theme };
  return { theme, mode };
}
