import { resolveOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { ThemeScript } from "@/components/theme-script";

export default async function PagesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let theme = "dark";
  let mode = "dark";
  let texture = "none";
  let glow = "none";

  const ctx = await resolveOrg();
  if (ctx) {
    const org = await db.organization.findUnique({
      where: { id: ctx.orgId },
      select: { theme: true, mode: true, texture: true, glow: true },
    });
    if (org) {
      theme = org.theme;
      mode = org.mode;
      texture = org.texture;
      glow = org.glow;
    }
  }

  return (
    <>
      <ThemeScript theme={theme} mode={mode} texture={texture} glow={glow} />
      {children}
    </>
  );
}
