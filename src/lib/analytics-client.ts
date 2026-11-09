"use client";

// Browser-side event capture. A no-op unless PostHog was initialised by
// src/instrumentation-client.ts (NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN set).
const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;

export function trackClient(event: string, properties: Record<string, unknown> = {}): void {
  if (!token) return;
  void import("posthog-js")
    .then(({ default: posthog }) => {
      if (posthog.__loaded) posthog.capture(event, properties);
    })
    .catch(() => {
      // Analytics must never break the UI.
    });
}
