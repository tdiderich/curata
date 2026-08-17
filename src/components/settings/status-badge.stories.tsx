import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { StatusBadge, type StatusBadgeTone } from "./status-badge";

const TONES: StatusBadgeTone[] = [
  "block",
  "review",
  "guidance",
  "approval",
  "topic",
  "vendor",
  "finding",
  "framework",
];

const meta = {
  title: "Components/StatusBadge",
  component: StatusBadge,
  args: { tone: "approval", label: "approved" },
  argTypes: {
    tone: { control: "select", options: TONES },
  },
} satisfies Meta<typeof StatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const AllTones: Story = {
  render: () => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {TONES.map((tone) => (
        <StatusBadge key={tone} tone={tone} label={tone} />
      ))}
    </div>
  ),
};
