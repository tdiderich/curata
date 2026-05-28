import Link from "next/link";
import { AUTH_MODE, resolveOrg } from "@/lib/auth";
import { db } from "@/lib/db";

async function AuthControls() {
  if (AUTH_MODE === "clerk") {
    const { UserButton } = await import("@clerk/nextjs");
    return <UserButton />;
  }
  if (AUTH_MODE === "oauth") {
    return (
      <Link href="/api/auth/signout" className="nav-link">
        Sign out
      </Link>
    );
  }
  return null;
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let siteName = "curata";

  try {
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
  } catch {
    // build-time fallback
  }

  return (
    <>
      <div className="site-bar">
        <Link className="site-bar-name" href="/">
          {siteName}
        </Link>
        <div className="site-bar-right">
          <AuthControls />
        </div>
      </div>
      <main className="container main-content">{children}</main>
    </>
  );
}
