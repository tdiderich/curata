import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SegmentedControl } from "./segmented-control";

const meta = {
  title: "Components/SegmentedControl",
  component: SegmentedControl,
} satisfies Meta<typeof SegmentedControl>;

export default meta;
type Story = StoryObj<typeof meta>;

const defaultArgs = {
  value: "",
  options: [{ value: "a", label: "A" }],
  onChange: () => {},
};

export const TwoOptions: Story = {
  args: defaultArgs,
  render: function TwoOptions() {
    const [value, setValue] = useState<"month" | "annual">("month");
    return (
      <SegmentedControl
        value={value}
        onChange={setValue}
        options={[
          { value: "month", label: "Monthly" },
          { value: "annual", label: "Annual" },
        ]}
      />
    );
  },
};

export const WithDisabledOption: Story = {
  args: defaultArgs,
  render: function WithDisabledOption() {
    const [value, setValue] = useState<"warn" | "block">("warn");
    return (
      <SegmentedControl
        value={value}
        onChange={setValue}
        options={[
          { value: "warn", label: "Warn" },
          { value: "block", label: "Block" },
        ]}
        disabledOptions={["block"]}
      />
    );
  },
};

export const WithIcons: Story = {
  args: defaultArgs,
  render: function WithIcons() {
    const [value, setValue] = useState<"topic" | "vendor" | "finding">("topic");
    return (
      <SegmentedControl
        value={value}
        onChange={setValue}
        options={[
          { value: "topic", label: "topic", icon: <span className="pg-tag-kind-dot pg-dot-topic" aria-hidden /> },
          { value: "vendor", label: "vendor", icon: <span className="pg-tag-kind-dot pg-dot-vendor" aria-hidden /> },
          { value: "finding", label: "finding", icon: <span className="pg-tag-kind-dot pg-dot-finding" aria-hidden /> },
        ]}
      />
    );
  },
};
