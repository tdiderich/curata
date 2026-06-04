import Link from "next/link";
import { AUTH_MODE, resolveOrg, resolveCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

function UserAvatar({ name, email }: { name: string; email: string }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <div className="user-avatar-group">
      <span className="user-avatar-initials">{initials || "?"}</span>
      <span className="user-avatar-name">{name || email}</span>
    </div>
  );
}

async function AuthControls() {
  if (AUTH_MODE === "clerk") {
    const { UserButton } = await import("@clerk/nextjs");
    return <UserButton />;
  }
  if (AUTH_MODE === "oauth") {
    const user = await resolveCurrentUser();
    return (
      <div className="user-avatar-group">
        {user && <UserAvatar name={user.name} email={user.email} />}
        <Link href="/api/auth/signout" className="nav-link">
          Sign out
        </Link>
      </div>
    );
  }
  if (AUTH_MODE === "tailscale") {
    const user = await resolveCurrentUser();
    if (user) return <UserAvatar name={user.name} email={user.email} />;
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
