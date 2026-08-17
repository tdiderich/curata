import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Toaster, toast } from "./toast";

const meta = {
  title: "Components/Toast",
  component: Toaster,
} satisfies Meta<typeof Toaster>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => (
    <>
      <Toaster />
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn--ghost" onClick={() => toast.success("Saved")}>
          Success
        </button>
        <button className="btn btn--ghost" onClick={() => toast.error("Something broke")}>
          Error
        </button>
        <button className="btn btn--ghost" onClick={() => toast.info("Heads up")}>
          Info
        </button>
      </div>
    </>
  ),
};
