import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AUTH_MODE, resolveOrg, resolveCurrentUser } from "@/lib/auth";
import { seedOrg, seedOrgContent } from "@/lib/seed";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { isPersonalEmailDomain } from "@/lib/personal-domains";
import { MemberList } from "@/components/member-list";
import { GroupManager } from "@/components/group-manager";
import { OrgSettings } from "@/components/org-settings";
import { ThemeSettings } from "@/components/theme-settings";
import { ApiKeyManager } from "@/components/api-key-manager";
import { ConnectManager } from "@/components/connect-manager";
import { ContentRulesEditor } from "@/components/content-rules-editor";
import { TagsManager } from "@/components/tags-manager";
import { SettingsTabs, SettingsSection, TeamChip } from "@/components/settings";
import { getEntitlements } from "@/lib/entitlements";

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

  // Idempotent: backfills any seed templates/workflows added to this build
  // since the org was created. seedOrg() only seeds brand-new orgs, so
  // existing orgs would otherwise never pick up new seed content.
  await seedOrgContent(ctx.orgId);

  const canManage = can(ctx.role, "member:manage");
  const canManageKeys = can(ctx.role, "key:manage");
  const canManageRules = can(ctx.role, "rules:manage");

  // Team chip is a pay-to-play signal only (every feature stays usable on
  // every plan) — it renders only when entitlements come back finite, so
  // self-hosted orgs (always unlimited) never see it.
  const { maxMembers } = await getEntitlements(ctx.orgId);
  const limitedPlan = Number.isFinite(maxMembers);

  const org = await db.organization.findUnique({
    where: { id: ctx.orgId },
    select: { name: true, slug: true, domain: true, logoUrl: true, logoMime: true, theme: true, mode: true, texture: true, glow: true, rules: true },
  });

  const globalRules = (() => {
    const raw = org?.rules;
    if (!raw || !Array.isArray(raw)) return [];
    return (raw as Array<Record<string, unknown>>).filter(
      (r) => typeof r.id === "string" && r.id !== "org-tags" && typeof r.text === "string"
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
    {
      label: "Connect",
      content: <ConnectManager authMode={AUTH_MODE} canManageKeys={canManageKeys} />,
    },
    {
      label: "Groups",
      labelExtra: limitedPlan ? <TeamChip /> : null,
      content: <GroupManager canManage={canManage} />,
    },
    {
      label: "Members",
      labelExtra: limitedPlan ? <TeamChip /> : null,
      // /billing and /org are cloud-overlay-only routes, never part of OSS.
      // limitedPlan and AUTH_MODE are both false on self-hosted OSS, so
      // invite stays undefined there and the banner never renders a link
      // into a page that doesn't exist.
      content: (
        <MemberList
          canManage={canManage}
          currentUserId={ctx.userId}
          invite={limitedPlan ? { kind: "upgrade", href: "/billing" } : AUTH_MODE === "clerk" ? { kind: "invite", href: "/org" } : undefined}
        />
      ),
    },
    // Cloud-only: /billing and /org live in the overlay, and self-hosted
    // deployments have no subscription to manage.
    ...(AUTH_MODE === "clerk" ? [{
      label: "Billing",
      labelExtra: limitedPlan ? <TeamChip /> : null,
      content: (
        <SettingsSection
          title="Billing"
          description={limitedPlan
            ? "This organization is on the Personal plan: solo, 128k-token brain."
            : "This organization is on the Team plan."}
        >
          <div className="settings-billing-links">
            <Link href="/billing" className="btn btn--primary">
              {limitedPlan ? "See plans & upgrade" : "Manage plan"}
            </Link>
            <Link href="/org" className="btn btn--ghost">
              Invoices &amp; payment methods
            </Link>
          </div>
        </SettingsSection>
      ),
    }] : []),
    ...(canManageRules ? [{
      label: "Tags",
      content: <TagsManager canManage={canManageRules} />,
    }] : []),
    ...(canManageRules ? [{
      label: "Content Rules",
      content: (
        <SettingsSection
          title="Content rules"
          description="Checked on every save. Blocked writes cite the rule that stopped them."
        >
          <ContentRulesEditor
            scopeParam="scope=global"
            initialRules={globalRules}
            canManage={canManageRules}
            limitedPlan={limitedPlan}
          />
        </SettingsSection>
      ),
    }] : []),
    ...(canManageKeys ? [{
      label: "API Keys",
      content: <ApiKeyManager />,
    }] : []),
  ];

  return (
    <>
      <div className="dash-root">
        <div className="dash-workspace">
          <SettingsTabs tabs={tabs} />
        </div>
      </div>
    </>
  );
}
