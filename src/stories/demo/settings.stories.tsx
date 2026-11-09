import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ActionBar } from "@/components/action-bar";
import { HelpCenter } from "@/components/help-center";
import { SettingsTabs, SettingsSection } from "@/components/settings";
import { OrgSettings } from "@/components/org-settings";
import { ThemeSettings } from "@/components/theme-settings";
import { ConnectManager } from "@/components/connect-manager";
import { GroupManager } from "@/components/group-manager";
import { MemberList } from "@/components/member-list";
import { TagsManager } from "@/components/tags-manager";
import { ContentRulesEditor } from "@/components/content-rules-editor";
import { ApiKeyManager } from "@/components/api-key-manager";
import { freshPages } from "./fixtures";
import { ORG, SETTINGS_ROUTES, globalRules } from "./settings.fixtures";

// Screens for the settings help video (public/help/settings.mp4): the same
// tabs src/app/(app)/settings/page.tsx renders for an admin on self-hosted
// curata. Capture steps click through the tabs.

/** Answer the tabs' mount-time reads from fixtures. In beforeEach so it is in
 * place before child effects fire. Longest matching prefix wins. */
function mockFetch(routes: Record<string, unknown>) {
  const real = window.fetch;
  const keys = Object.keys(routes).sort((a, b) => b.length - a.length);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const hit = keys.find((p) => new URL(url, window.location.href).pathname.endsWith(p));
    if (hit) return new Response(JSON.stringify(routes[hit]), { status: 200, headers: { "content-type": "application/json" } });
    return real(input, init);
  };
  return () => { window.fetch = real; };
}

function SettingsScreen() {
  const tabs = [
    { label: "Admin", content: <OrgSettings canManage isPersonalDomain={false} initial={ORG} /> },
    { label: "Theme", content: <ThemeSettings canManage initial={{ theme: "dark", mode: "dark", texture: "none", glow: "none", depth: "soft" }} /> },
    { label: "Connect", content: <ConnectManager authMode="oauth" canManageKeys /> },
    { label: "Groups", content: <GroupManager canManage /> },
    { label: "Members", content: <MemberList canManage currentUserId="u-dana" /> },
    { label: "Tags", content: <TagsManager canManage /> },
    {
      label: "Content Rules",
      content: (
        <SettingsSection title="Content rules" description="Checked on every save. Blocked writes cite the rule that stopped them.">
          <ContentRulesEditor scopeParam="scope=global" initialRules={globalRules} canManage />
        </SettingsSection>
      ),
    },
    { label: "API Keys", content: <ApiKeyManager /> },
  ];
  return (
    <div className="app-shell">
      <ActionBar orgName="Acme" logoUrl={null} pages={freshPages} authControls={null} />
      <main className="app-main">
        <div className="dash-root">
          <div className="dash-workspace">
            <SettingsTabs tabs={tabs} />
          </div>
        </div>
      </main>
      <HelpCenter authMode="none" />
    </div>
  );
}

const meta = {
  title: "Demo/Settings",
  parameters: {
    demoScreen: true,
    layout: "fullscreen",
    nextjs: { appDirectory: true, navigation: { pathname: "/settings" } },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Org settings for an admin. Capture steps click into each tab. */
export const Settings: Story = { beforeEach: () => mockFetch(SETTINGS_ROUTES), render: () => <SettingsScreen /> };
