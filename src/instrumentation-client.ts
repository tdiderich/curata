// Optional product analytics. PostHog loads only when
// NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is set at build time, so self-hosted
// installs ship no analytics by default. Events go through the same-origin
// /ingest proxy (see next.config.ts), which keeps the CSP at connect-src 'self'
// and survives most ad blockers.
const posthogToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;

if (posthogToken) {
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";
  void import("posthog-js").then(({ default: posthog }) => {
    posthog.init(posthogToken, {
      api_host: "/ingest",
      ui_host: host.replace(".i.posthog.com", ".posthog.com"),
      defaults: "2026-08-30",
    });
  });
}
