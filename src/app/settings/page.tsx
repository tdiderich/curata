import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings — curata" };
import { resolveOrg, resolveCurrentUser } from "@/lib/auth";
import { seedOrg } from "@/lib/seed";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { isPersonalEmailDomain } from "@/lib/personal-domains";
import { MemberList } from "@/components/member-list";
import { OrgSettings } from "@/components/org-settings";
import { ThemeSettings } from "@/components/theme-settings";
import { ApiKeyManager } from "@/components/api-key-manager";

export default async function SettingsPage() {
  let ctx = await resolveOrg();
  if (!ctx) {
    await seedOrg("curata");
    ctx = await resolveOrg();
  }
  if (!ctx) redirect("/sign-in");

  const canManage = can(ctx.role, "member:manage");
  const canManageKeys = can(ctx.role, "key:manage");

  const org = await db.organization.findUnique({
    where: { id: ctx.orgId },
    select: { name: true, slug: true, domain: true, theme: true, mode: true, texture: true, glow: true },
  });

  // Determine if the current user's email is a personal domain so we can
  // hide the auto-join domain field for them.
  const currentUser = await resolveCurrentUser();
  const userEmail = currentUser?.email ?? "";
  const userDomain = userEmail.split("@")[1]?.toLowerCase() ?? "";
  const isPersonalDomain = userDomain ? isPersonalEmailDomain(userDomain) : false;

  return (
    <>
      <div className="site-bar">
        <Link href="/dashboard" className="site-bar-back">
          &larr; Dashboard
        </Link>
        <span className="site-bar-title">Settings</span>
      </div>
      <div className="dash-root">
        <div className="dash-workspace">
          <div className="dash-workspace-header dash-workspace-header--top">
            <span className="dash-workspace-label">Organization</span>
          </div>
          <OrgSettings
            canManage={canManage}
            isPersonalDomain={isPersonalDomain}
            initial={{ name: org?.name ?? "", slug: org?.slug ?? "", domain: org?.domain ?? "" }}
          />
          <div className="dash-workspace-header dash-workspace-header--top">
            <span className="dash-workspace-label">Theme</span>
          </div>
          <ThemeSettings
            canManage={canManage}
            initial={{
              theme: org?.theme ?? "dark",
              mode: org?.mode ?? "dark",
              texture: org?.texture ?? "none",
              glow: org?.glow ?? "none",
            }}
          />
          {canManageKeys && (
            <>
              <div className="dash-workspace-header">
                <span className="dash-workspace-label">API Keys</span>
              </div>
              <ApiKeyManager />
            </>
          )}
          <div className="dash-workspace-header">
            <span className="dash-workspace-label">Members</span>
          </div>
          <MemberList canManage={canManage} currentUserId={ctx.userId} />
        </div>
      </div>
    </>
  );
}
