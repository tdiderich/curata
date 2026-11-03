"use client";

import { useEffect } from "react";

// Ties the browser's anonymous PostHog session to the signed-in user and their
// org. Rendered by the (app) layout, which already resolves both server-side
// in every AUTH_MODE. Does nothing when PostHog isn't configured.
export function AnalyticsIdentify({
  userId,
  email,
  name,
  orgId,
  orgName,
}: {
  userId: string;
  email: string;
  name: string;
  orgId: string;
  orgName: string;
}) {
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN) return;
    void import("posthog-js").then(({ default: posthog }) => {
      if (posthog.get_distinct_id() !== userId) {
        posthog.identify(userId, { email, name });
      }
      posthog.group("organization", orgId, { name: orgName });
    });
  }, [userId, email, name, orgId, orgName]);
  return null;
}
