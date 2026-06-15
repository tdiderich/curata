import Link from "next/link";
import { AUTH_MODE, resolveOrg, resolveCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { basePath } from "@/lib/api-fetch";
import { Sidebar, type SidebarFolder, type SidebarPage } from "@/components/sidebar";

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

// Shared shell for authenticated app routes: persistent left nav with the
// folder tree, pinned pages, and recents. Page-level auth redirects still
// happen in each route; when there's no org context we render bare children.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let folders: SidebarFolder[] = [];
  let pages: SidebarPage[] = [];
  let archivedPages: SidebarPage[] = [];
  let orgName = "curata";
  let logoUrl: string | null = null;
  let cleanupCount = 0;

  try {
    const ctx = await resolveOrg();
    if (ctx) {
      const org = await db.organization.findUnique({
        where: { id: ctx.orgId },
        select: { name: true, logoUrl: true, logoMime: true, updatedAt: true },
      });
      if (org?.name) orgName = org.name;
      // basePath matters when the app is mounted under a subpath
      // (maze-apps serves curata at /ts-hub) — a root-relative src 404s there.
      logoUrl = org?.logoMime
        ? `${basePath}/api/org-logo?v=${org.updatedAt.getTime()}`
        : (org?.logoUrl ?? null);

      const rawFolders = await db.folder.findMany({
        where: {
          orgId: ctx.orgId,
          OR: [
            { visibility: "shared" },
            { visibility: "personal", createdBy: ctx.userId },
          ],
        },
        orderBy: { name: "asc" },
        select: { id: true, name: true, parentId: true, visibility: true },
      });
      folders = rawFolders;

      const rawPages = await db.page.findMany({
        where: {
          orgId: ctx.orgId,
          status: { not: "archived" },
          OR: [
            { visibility: "shared" },
            { visibility: "public" },
            { visibility: "personal", createdBy: ctx.userId },
          ],
        },
        orderBy: { title: "asc" },
        select: { slug: true, title: true, folderId: true, pinned: true, visibility: true },
      });
      pages = rawPages;

      const rawArchived = await db.page.findMany({
        where: {
          orgId: ctx.orgId,
          status: "archived",
          OR: [
            { visibility: "shared" },
            { visibility: "public" },
            { visibility: "personal", createdBy: ctx.userId },
          ],
        },
        orderBy: { title: "asc" },
        select: { slug: true, title: true, folderId: true, pinned: true, visibility: true },
      });
      archivedPages = rawArchived;

      cleanupCount = await db.pageFlag.count({
        where: {
          page: { orgId: ctx.orgId },
          OR: [
            { status: "pending" },
            { status: "snoozed", snoozeUntil: { lte: new Date() } },
          ],
        },
      });
    }
  } catch {
    // DB unavailable (static generation) — render without nav data.
  }

  return (
    <div className="app-shell">
      <Sidebar folders={folders} pages={pages} archivedPages={archivedPages} orgName={orgName} logoUrl={logoUrl} cleanupCount={cleanupCount} authControls={<AuthControls />} />
      <main className="app-main">{children}</main>
    </div>
  );
}
