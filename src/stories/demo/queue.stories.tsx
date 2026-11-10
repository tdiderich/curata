import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ReviewQueueClient } from "@/components/review-queue-client";
import { CleanupClient } from "@/components/cleanup-client";
import { archivedRows, flagsResponse, reviewRows, versionsResponse } from "./queue.fixtures";

// Screens for the review and cleanup help videos (public/help/review.mp4,
// cleanup.mp4). Real components, fixture data; the few reads they make are
// answered by a fetch mock installed in beforeEach, before child effects run.

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

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <main className="app-main">{children}</main>
    </div>
  );
}

const meta = {
  title: "Demo/Queue",
  parameters: {
    demoScreen: true,
    layout: "fullscreen",
    nextjs: { appDirectory: true, navigation: { pathname: "/review" } },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Review queue: never-trusted pages and pages with newer edits. Capture steps open a diff. */
export const Review: Story = {
  beforeEach: () => mockFetch({ "/api/versions": versionsResponse }),
  render: () => (
    <Shell>
      <ReviewQueueClient rows={reviewRows} canTrust />
    </Shell>
  ),
};

/** Cleanup: flags an agent's audit filed, plus archived pages on the second tab. */
export const Cleanup: Story = {
  parameters: { nextjs: { appDirectory: true, navigation: { pathname: "/cleanup" } } },
  beforeEach: () => mockFetch({ "/api/flags": flagsResponse }),
  render: () => (
    <Shell>
      <CleanupClient initialArchived={archivedRows} />
    </Shell>
  ),
};
