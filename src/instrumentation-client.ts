// Optional product analytics. PostHog loads only when
// NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is set at build time, so self-hosted
// installs ship no analytics by default. Events go through the same-origin
// /ingest proxy (see next.config.ts), which keeps the CSP at connect-src 'self'
// and survives most ad blockers.
//
// Public /p/<org>/<page> routes are an org's published content, read by that
// org's audience, so curata does not track them: no init when a visit lands
// there, and events from an in-app navigation into /p/ are dropped.
const posthogToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const isPublicPage = (path: string) => path === "/p" || path.startsWith("/p/");

if (posthogToken && !isPublicPage(window.location.pathname)) {
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";
  void import("posthog-js").then(({ default: posthog }) => {
    posthog.init(posthogToken, {
      api_host: "/ingest",
      ui_host: host.replace(".i.posthog.com", ".posthog.com"),
      defaults: "2026-08-30",
      // Replays of the signed-in app would otherwise capture private page
      // content. Marketing pages stay readable.
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: ".app-shell *",
      },
      before_send: (event) => (isPublicPage(window.location.pathname) ? null : event),
    });
  });
}
