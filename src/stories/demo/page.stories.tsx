import yaml from "js-yaml";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import PageDetailClient from "@/components/page-detail-client";
import { ActionBar } from "@/components/action-bar";
import { ContentRulesEditor } from "@/components/content-rules-editor";
import { PageRenderer, type PageData } from "@/generated/kazam-renderer";
import runbookYaml from "../../../seed/templates/columns.yaml?raw";
import agentPageJson from "./agent-page.json";
import { freshPages } from "./fixtures";

// Screens for the welcome video's feature montage and the page help video:
// the real page view (dock, Present, Export PDF) and the real folder rules
// panel. Stories are pure fixtures; capture steps click into each state.

const runbook = yaml.load(runbookYaml) as PageData;
const SLUG = "production-deploy-runbook";
// A page the starter prompt really wrote (see fixtures.ts). Four sections, so
// Present gives a real multi-slide deck.
const agentPage = agentPageJson as unknown as PageData;

/** Fixture answers for the few reads these components make on mount.
 * Installed in beforeEach so it is in place before child effects fire. */
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

const FOLDER_RULES = [
  { id: "r-owner", text: "Runbooks name an owner and a rollback step", mode: "warn" as const },
  { id: "r-secrets", text: "Never include API keys, tokens, or passwords", mode: "block" as const, patterns: ["sk-[A-Za-z0-9]{20,}"] },
];
const RULE_ROUTES = { "/api/rules": { rules: FOLDER_RULES }, "/api/groups": [], "/api/members": [] };

function PageView({ page = runbook, slug = SLUG }: { page?: PageData; slug?: string }) {
  return (
    <div className="app-shell">
      <ActionBar orgName="Acme" logoUrl={null} pages={freshPages} authControls={null} />
      <main className="app-main">
        <PageDetailClient
          slug={slug}
          annotations={[]}
          pageTitle={page.title as string}
          orgSlug="acme"
          visibility="org"
          autoConnect={false}
          authMode="none"
          shell="standard"
          pageJson={page}
          inheritedRules={FOLDER_RULES.map((r) => ({ ...r, scope: "folder" }))}
        >
          <PageRenderer page={page} />
        </PageDetailClient>
      </main>
    </div>
  );
}

function FolderRules() {
  // Same markup folder-actions.tsx renders for a folder's "Content Rules".
  return (
    <div className="app-shell">
      <div className="rules-panel-overlay">
        <div className="rules-panel">
          <div className="rules-panel-header">
            <span className="rules-panel-title">Content Rules: Engineering</span>
            <button className="rules-panel-close">&times;</button>
          </div>
          <div className="rules-panel-body" style={{ padding: "12px 20px" }}>
            <ContentRulesEditor scopeParam="scope=folder:f-eng" initialRules={FOLDER_RULES} canManage />
          </div>
        </div>
      </div>
    </div>
  );
}

const meta = {
  title: "Demo/Page",
  parameters: {
    demoScreen: true,
    layout: "fullscreen",
    nextjs: { appDirectory: true, navigation: { pathname: `/pages/${SLUG}` } },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** A page with its dock. Capture steps click Present for presentation mode. */
export const Runbook: Story = { render: () => <PageView /> };

/** The agent-written page. Capture steps click Present for slides. */
export const AgentPage: Story = { render: () => <PageView page={agentPage} slug="eng-dev-setup" /> };

/** A folder's content rules: one warn rule, one block rule. */
export const Rules: Story = { beforeEach: () => mockFetch(RULE_ROUTES), render: () => <FolderRules /> };
