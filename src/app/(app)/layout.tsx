import Link from "next/link";
import { AUTH_MODE, resolveOrg, resolveCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { basePath } from "@/lib/api-fetch";
import { ActionBar } from "@/components/action-bar";
import type { ActionBarPage } from "@/components/action-bar-types";

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

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let pages: ActionBarPage[] = [];
  let orgName = "curata";
  let logoUrl: string | null = null;

  try {
    const ctx = await resolveOrg();
    if (ctx) {
      const org = await db.organization.findUnique({
        where: { id: ctx.orgId },
        select: { name: true, logoUrl: true, logoMime: true, updatedAt: true },
      });
      if (org?.name) orgName = org.name;
      logoUrl = org?.logoMime
        ? `${basePath}/api/org-logo?v=${org.updatedAt.getTime()}`
        : (org?.logoUrl ?? null);

      const pageVisFilter = AUTH_MODE === "none"
        ? { orgId: ctx.orgId, status: { not: "archived" } }
        : {
            orgId: ctx.orgId,
            status: { not: "archived" },
            OR: [
              { createdBy: ctx.userId },
              { shares: { some: { userId: ctx.userId } } },
              { visibility: { in: ["org", "public", "shared"] } },
            ],
          };
      const rawPages = await db.page.findMany({
        where: pageVisFilter,
        orderBy: { title: "asc" },
        select: { slug: true, title: true, folderId: true, pinned: true, visibility: true },
      });
      pages = rawPages;
    }
  } catch {
    // DB unavailable (static generation)
  }

  return (
    <div className="app-shell">
      <ActionBar
        orgName={orgName}
        logoUrl={logoUrl}
        pages={pages}
        authControls={<AuthControls />}
      />
      <main className="app-main">{children}</main>
    </div>
  );
}
