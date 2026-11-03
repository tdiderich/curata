import { PostHog } from "posthog-node";

// Optional server-side product analytics. A no-op unless
// NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is set, matching the browser init in
// src/instrumentation-client.ts. Agent traffic (MCP tool calls) never touches
// a browser, so this is the only place that usage is visible.
//
// Every event carries the organization group, so funnels and retention can be
// read per org. distinct_id is the acting user when known (the same id the
// browser identifies with), otherwise a stable per-org id.

const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

let client: PostHog | null = null;
function getClient(): PostHog | null {
  if (!token) return null;
  if (!client) {
    client = new PostHog(token, { host, flushAt: 20, flushInterval: 10_000 });
  }
  return client;
}

export function track(
  event: string,
  orgId: string,
  userId?: string | null,
  properties: Record<string, unknown> = {}
): void {
  const ph = getClient();
  if (!ph) return;
  try {
    ph.capture({
      distinctId: userId || `org:${orgId}`,
      event,
      groups: { organization: orgId },
      properties: { ...properties, $process_person_profile: Boolean(userId) },
    });
  } catch (err) {
    // Analytics must never take a request down with it.
    console.error("[analytics] capture failed:", err);
  }
}

export function identifyOrg(orgId: string, properties: Record<string, unknown>): void {
  const ph = getClient();
  if (!ph) return;
  try {
    ph.groupIdentify({ groupType: "organization", groupKey: orgId, properties });
  } catch (err) {
    console.error("[analytics] groupIdentify failed:", err);
  }
}
