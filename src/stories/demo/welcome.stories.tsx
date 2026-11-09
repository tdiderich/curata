import { useEffect } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ActionBarHome } from "@/components/action-bar-home";
import { HelpCenter, openHelp } from "@/components/help-center";
import AgentConnectModal from "@/components/agent-connect-modal";
import { agentFolder, agentPages, capturedPage, freshFolders, freshPages, vocabulary } from "./fixtures";

// Screens for the welcome help video (public/help/welcome.mp4). Each story is
// one state the video cuts to; scripts/help-videos captures them with
// Playwright. Keep them deterministic: fixture data only, no network.

function Home({ withCapture = false, withAgent = false }: { withCapture?: boolean; withAgent?: boolean }) {
  return (
    <div className="app-shell">
      <main className="app-main">
        <ActionBarHome
          vocabulary={vocabulary}
          folders={withAgent ? [agentFolder, ...freshFolders] : freshFolders}
          pages={[...(withCapture ? [capturedPage] : []), ...(withAgent ? agentPages : []), ...freshPages]}
          orgName="Acme"
          logoUrl={null}
        />
      </main>
    </div>
  );
}

function OpenHelpOnMount() {
  useEffect(() => {
    const t = setTimeout(() => openHelp("demo", "welcome"), 300);
    return () => clearTimeout(t);
  }, []);
  return null;
}

const meta = {
  title: "Demo/Welcome",
  parameters: {
    demoScreen: true,
    layout: "fullscreen",
    nextjs: { appDirectory: true, navigation: { pathname: "/dashboard" } },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Beat 1: a new org's home. Stocked with skills and docs, dock labelled. */
export const HomeFresh: Story = {
  render: () => <Home />,
};

/** Help opened from the dock (used by the page video and the Help beat). */
export const HelpOpen: Story = {
  render: () => (
    <>
      <Home />
      <HelpCenter authMode="none" />
      <OpenHelpOnMount />
    </>
  ),
};

/** The connect modal the welcome CTA opens. */
export const ConnectAgent: Story = {
  render: () => (
    <>
      <Home />
      <AgentConnectModal slug="home" onClose={() => {}} authMode="none" />
    </>
  ),
};

/** After the starter prompt: the agent's folder and pages on home. */
export const HomeAfterAgent: Story = {
  render: () => <Home withAgent />,
};

/** Last beat (v1): the page the agent just saved shows up on home. */
export const HomeAfterCapture: Story = {
  render: () => <Home withCapture />,
};
