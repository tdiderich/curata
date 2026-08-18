import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ConfirmDeleteModal } from "./confirm-delete-modal";

const meta = {
  title: "Components/ConfirmDeleteModal",
  component: ConfirmDeleteModal,
  args: {
    title: "Delete Folder",
    confirmButtonLabel: "Delete Folder",
    busyLabel: "Deleting...",
    busy: false,
    onCancel: () => console.log("Cancel clicked"),
    onConfirm: () => console.log("Confirm clicked"),
    children: (
      <p style={{ margin: "0 0 12px 0", fontSize: "0.9rem", color: "var(--text-dim)" }}>
        Are you sure you want to delete this folder? Pages inside will be moved to root.
      </p>
    ),
  },
} satisfies Meta<typeof ConfirmDeleteModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Standard: Story = {};

export const RequireTypedConfirmation: Story = {
  args: {
    title: "Delete Group",
    confirmValue: "security-team",
    confirmPrompt: 'Type "security-team" to confirm deletion:',
    confirmButtonLabel: "Delete Group",
    children: (
      <p style={{ margin: "0 0 12px 0", fontSize: "0.9rem", color: "var(--text-dim)" }}>
        This action cannot be undone. All membership links will be permanently removed.
      </p>
    ),
  },
};
