import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { TeamChip } from "./team-chip";

const meta = {
  title: "Components/TeamChip",
  component: TeamChip,
} satisfies Meta<typeof TeamChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
