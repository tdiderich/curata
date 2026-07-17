import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AUTH_MODE, resolveOrg, resolveCurrentUser } from "@/lib/auth";
import { seedOrg } from "@/lib/seed";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { isPersonalEmailDomain } from "@/lib/personal-domains";
import { MemberList } from "@/components/member-list";
import { OrgSettings } from "@/components/org-settings";
import { ThemeSettings } from "@/components/theme-settings";
import { ApiKeyManager } from "@/components/api-key-manager";
import { ContentRulesEditor } from "@/components/content-rules-editor";
import { SettingsTabs } from "@/components/settings-tabs";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return { title: "Settings" };
}

export default async function SettingsPage() {
  let ctx = await resolveOrg();
  if (!ctx && AUTH_MODE !== "clerk") {
    await seedOrg("curata");
    ctx = await resolveOrg();
  }
  if (!ctx) redirect(AUTH_MODE === "clerk" ? "/onboarding" : "/sign-in");

  const canManage = can(ctx.role, "member:manage");
  const canManageKeys = can(ctx.role, "key:manage");
  const canManageRules = can(ctx.role, "rules:manage");

  const org = await db.organization.findUnique({
    where: { id: ctx.orgId },
    select: { name: true, slug: true, domain: true, logoUrl: true, logoMime: true, theme: true, mode: true, texture: true, glow: true, rules: true },
  });

  const globalRules = (() => {
    const raw = org?.rules;
    if (!raw || !Array.isArray(raw)) return [];
    return (raw as Array<Record<string, unknown>>).filter(
      (r) => typeof r.id === "string" && typeof r.text === "string"
    ).map((r) => ({
      id: r.id as string,
      text: r.text as string,
      mode: (r.mode === "block" ? "block" : "warn") as "block" | "warn",
      ...(Array.isArray(r.patterns) ? { patterns: r.patterns as string[] } : {}),
    }));
  })();

  const currentUser = await resolveCurrentUser();
  const userEmail = currentUser?.email ?? "";
  const userDomain = userEmail.split("@")[1]?.toLowerCase() ?? "";
  const isPersonalDomain = userDomain ? isPersonalEmailDomain(userDomain) : false;

  const tabs = [
    {
      label: "Admin",
      content: (
        <OrgSettings
          canManage={canManage}
          isPersonalDomain={isPersonalDomain}
          initial={{ name: org?.name ?? "", slug: org?.slug ?? "", domain: org?.domain ?? "", logoUrl: org?.logoUrl ?? "", hasLogo: Boolean(org?.logoMime) }}
        />
      ),
    },
    {
      label: "Theme",
      content: (
        <ThemeSettings
          canManage={canManage}
          initial={{
            theme: org?.theme ?? "dark",
            mode: org?.mode ?? "dark",
            texture: org?.texture ?? "none",
            glow: org?.glow ?? "none",
          }}
        />
      ),
    },
    ...(canManageKeys ? [{
      label: "API Keys",
      content: <ApiKeyManager />,
    }] : []),
    {
      label: "Members",
      content: <MemberList canManage={canManage} currentUserId={ctx.userId} />,
    },
    ...(canManageRules ? [{
      label: "Content Rules",
      content: (
        <ContentRulesEditor
          scopeParam="scope=global"
          initialRules={globalRules}
          canManage={canManageRules}
        />
      ),
    }] : []),
  ];

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
          <SettingsTabs tabs={tabs} />
        </div>
      </div>
    </>
  );
}
