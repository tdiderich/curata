import { NextResponse } from "next/server";
import { siteOrigin } from "@/lib/public-catalog";
import pkg from "../../../../../package.json";

// MCP Server Card (SEP-1649). Served at /.well-known/mcp/server-card.json via a
// rewrite in next.config.ts — Next's router does not pick up a literal
// `.well-known` directory under app/.
//
// The card only advertises where the server is and how to authenticate. It
// grants nothing: /api/mcp still requires an API key for anything beyond public
// pages.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = siteOrigin(request);

  const card = {
    $schema: "https://modelcontextprotocol.io/schemas/draft/server-card.json",
    serverInfo: {
      name: "curata",
      title: "curata",
      version: pkg.version,
      description:
        "Read and write structured pages: search, read, create, patch, and export pages and templates.",
      websiteUrl: origin,
    },
    transport: {
      type: "streamable-http",
      endpoint: `${origin}/api/mcp/stream`,
    },
    // The plain JSON-RPC shim, for clients that cannot speak streamable HTTP.
    alternativeTransports: [
      {
        type: "http",
        endpoint: `${origin}/api/mcp`,
      },
    ],
    capabilities: {
      tools: { listChanged: false },
    },
    authentication: {
      type: "http-bearer",
      description:
        "Send an API key as `Authorization: Bearer <key>`. Create one in Settings. Public pages are also readable without a key at /p/<org>/<slug>.md",
    },
    documentation: `${origin}/docs`,
  };

  return NextResponse.json(card, {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
