import Link from "next/link";
import { resolveOrg } from "@/lib/auth";
import { db } from "@/lib/db";

const AUTH_MODE = process.env.AUTH_MODE ?? "none";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let siteName = "curata";

  const ctx = await resolveOrg();
  if (ctx) {
    const org = await db.organization.findUnique({
      where: { id: ctx.orgId },
      select: { name: true },
    });
    if (org) {
      siteName = org.name;
    }
  }

  return (
    <>
      <div className="site-bar">
        <Link className="site-bar-name" href="/">
          {siteName}
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
