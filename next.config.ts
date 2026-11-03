import type { NextConfig } from "next";

// Optional PostHog reverse proxy, active only when a project token is set at
// build time. See src/instrumentation-client.ts.
const posthogEnabled = Boolean(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN);
const posthogHost = (process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com").replace(/\/$/, "");
// us.i.posthog.com -> us-assets.i.posthog.com; self-hosted hosts serve both.
const posthogAssetsHost = posthogHost.replace(/^https:\/\/(us|eu)\.i\./, "https://$1-assets.i.");
const posthogRewrites = posthogEnabled
  ? [
      { source: "/ingest/static/:path*", destination: `${posthogAssetsHost}/static/:path*` },
      { source: "/ingest/:path*", destination: `${posthogHost}/:path*` },
    ]
  : [];

const nextConfig: NextConfig = {
  // PostHog's API paths end in a slash; Next's trailing-slash redirect would
  // 308 them before the /ingest rewrite runs.
  skipTrailingSlashRedirect: posthogEnabled,
  async headers() {
    return [
      {
        // A public page URL answers with HTML, markdown, or YAML depending on
        // Accept, so any cache in front of it has to key on that header. This
        // lives here rather than in middleware because Next overwrites Vary on
        // the RSC response after middleware has run.
        source: "/p/:orgSlug/:pageSlug",
        headers: [{ key: "Vary", value: "Accept" }],
      },
    ];
  },
  async rewrites() {
    return [
      // Next's router ignores a literal `.well-known` directory under app/, so
      // the discovery documents live under /api/well-known and surface at their
      // standard paths from here.
      {
        source: "/.well-known/mcp/server-card.json",
        destination: "/api/well-known/mcp-server-card",
      },
      {
        source: "/.well-known/agent-skills/index.json",
        destination: "/api/well-known/agent-skills",
      },
      { source: "/.well-known/api-catalog", destination: "/api/well-known/api-catalog" },
      // OAuth 2.1 discovery for the MCP connector flow (clerk mode). Clients
      // derive the protected-resource metadata path from the resource URL they
      // were given (/mcp, /api/mcp/stream, or the bare origin), so every
      // path-suffixed variant serves the same document.
      {
        source: "/.well-known/oauth-protected-resource",
        destination: "/api/well-known/oauth-protected-resource",
      },
      {
        source: "/.well-known/oauth-protected-resource/:path*",
        destination: "/api/well-known/oauth-protected-resource",
      },
      {
        source: "/.well-known/oauth-authorization-server",
        destination: "/api/well-known/oauth-authorization-server",
      },
      {
        source: "/.well-known/oauth-authorization-server/:path*",
        destination: "/api/well-known/oauth-authorization-server",
      },
      // Short alias for the MCP endpoint. Some edge configurations exempt /mcp
      // from bot rules that would otherwise block an agent mid-session.
      // /mcp is the URL connector docs advertise, so it must speak the real
      // streamable-HTTP MCP transport — a JSON-RPC initialize against the REST
      // shim 400s with "missing tool". The shim stays at its literal /api/mcp
      // path (kazam's REST fetcher calls that directly).
      { source: "/mcp", destination: "/api/mcp/stream" },
      { source: "/mcp/:path*", destination: "/api/mcp/:path*" },
      ...posthogRewrites,
    ];
  },
};

export default nextConfig;
