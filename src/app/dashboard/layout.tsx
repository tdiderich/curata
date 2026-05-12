import Link from "next/link";
import { resolveOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { ThemeScript } from "@/components/theme-script";

const AUTH_MODE = process.env.AUTH_MODE ?? "none";

export default async function DashboardLayout({
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
      <div className="site-bar">
        <Link className="site-bar-name" href="/">
          curata
        </Link>
        <div className="site-bar-right">
          {AUTH_MODE === "oauth" ? (
            <Link href="/api/auth/signout" className="nav-link">
              Sign out
            </Link>
          ) : null}
        </div>
      </div>
      <main className="container main-content">{children}</main>
    </>
  );
}
