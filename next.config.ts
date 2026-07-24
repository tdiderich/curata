import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
      // Short alias for the MCP endpoint. Some edge configurations exempt /mcp
      // from bot rules that would otherwise block an agent mid-session.
      { source: "/mcp", destination: "/api/mcp" },
      { source: "/mcp/:path*", destination: "/api/mcp/:path*" },
    ];
  },
};

export default nextConfig;
