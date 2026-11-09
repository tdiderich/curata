import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ActionBar } from "@/components/action-bar";
import { SettingsTabs, SettingsSection } from "@/components/settings";
import { PageSettingsGeneral } from "@/components/page-settings-general";
import { PageSettingsTags } from "@/components/page-settings-tags";
import { PageSettingsMap } from "@/components/page-settings-map";
import { ContentRulesEditor } from "@/components/content-rules-editor";
import { freshPages } from "./fixtures";
import { SLUG, TITLE, folders, inheritedRules, mapNodes, mapView, pageRules, pageTags, tagOptions } from "./page-settings.fixtures";

// Screen for the page-settings help video (public/help/page-settings.mp4).
// Same tabs and components /pages/<slug>/settings renders, fed fixtures.
// Capture steps click between tabs.

function mockFetch(routes: Record<string, unknown>) {
  const real = window.fetch;
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const hit = Object.keys(routes).find((p) => url.includes(p));
    if (hit) return new Response(JSON.stringify(routes[hit]), { status: 200, headers: { "content-type": "application/json" } });
    return real(input, init);
  };
  return () => { window.fetch = real; };
}

const ROUTES = { "/api/rules": { rules: pageRules }, "/api/groups": [], "/api/members": [] };

function PageSettings() {
  const tabs = [
    {
      label: "General",
      content: <PageSettingsGeneral slug={SLUG} visibility="org" authMode="oauth" folderId="f-eng" folders={folders} canEdit />,
    },
    {
      label: "Tags",
      content: <PageSettingsTags pageId="p-eng-dev-setup" initialTags={pageTags} tagOptions={tagOptions} canEdit folderTag="curata engineering" />,
    },
    {
      label: "Content map",
      content: <PageSettingsMap slug={SLUG} title={TITLE} view={mapView} nodes={mapNodes} canEdit />,
    },
    {
      label: "Rules",
      content: (
        <SettingsSection title="Rules" description="Trust mode, approval, and content rules for this page.">
          <ContentRulesEditor
            scopeParam={`scope=page:${SLUG}`}
            initialRules={pageRules}
            canManage
            inheritedRules={inheritedRules}
            trustMode="locked"
            hasTrustRuleAtScope
            trustStatusLabel="Behind: a newer version is waiting on approval."
          />
        </SettingsSection>
      ),
    },
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
    </div>
  );
}

const meta = {
  title: "Demo/PageSettings",
  parameters: {
    demoScreen: true,
    layout: "fullscreen",
    nextjs: { appDirectory: true, navigation: { pathname: `/pages/${SLUG}/settings` } },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** All four tabs of a page's settings. Starts on General. */
export const Tabs: Story = { beforeEach: () => mockFetch(ROUTES), render: () => <PageSettings /> };
