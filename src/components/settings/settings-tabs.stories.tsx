import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SettingsTabs, type SettingsTab } from "./settings-tabs";

const SAMPLE_TABS: SettingsTab[] = [
  {
    label: "General",
    content: (
      <div style={{ padding: "16px 0" }}>
        <p>General configuration and workspace details.</p>
      </div>
    ),
  },
  {
    label: "Members",
    content: (
      <div style={{ padding: "16px 0" }}>
        <p>Manage workspace members and invitation permissions.</p>
      </div>
    ),
  },
  {
    label: "Content Rules",
    content: (
      <div style={{ padding: "16px 0" }}>
        <p>Automated rules and validation policies for pages.</p>
      </div>
    ),
  },
  {
    label: "Billing",
    labelExtra: <span style={{ marginLeft: 6, fontSize: "0.75rem", opacity: 0.7 }}>PRO</span>,
    content: (
      <div style={{ padding: "16px 0" }}>
        <p>Subscription tier, seats, and payment management.</p>
      </div>
    ),
  },
];

const meta = {
  title: "Components/SettingsTabs",
  component: SettingsTabs,
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: "/settings",
      },
    },
  },
  args: {
    tabs: SAMPLE_TABS,
  },
} satisfies Meta<typeof SettingsTabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
