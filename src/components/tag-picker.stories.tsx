import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { TagPicker, type TagOption } from "./tag-picker";

const SAMPLE_OPTIONS: TagOption[] = [
  { term: "architecture", kind: "topic" },
  { term: "security", kind: "topic" },
  { term: "auth", kind: "topic" },
  { term: "clerk", kind: "vendor" },
  { term: "railway", kind: "vendor" },
  { term: "stripe", kind: "vendor" },
  { term: "soc2", kind: "framework" },
  { term: "hipaa", kind: "framework" },
  { term: "cve-2026-104", kind: "finding" },
];

const meta = {
  title: "Components/TagPicker",
  component: TagPicker,
  args: {
    options: SAMPLE_OPTIONS,
    label: "add tags",
    onSave: async (tags) => {
      console.log("Saved tags:", tags);
      return true;
    },
  },
} satisfies Meta<typeof TagPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
