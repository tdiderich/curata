import { NextResponse } from "next/server";
import { siteOrigin } from "@/lib/public-catalog";

// API catalog (RFC 9727) as a linkset. Served at /.well-known/api-catalog via a
// rewrite in next.config.ts. Points agents at the MCP endpoint, its docs, and
// the health check.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = siteOrigin(request);

  const linkset = {
    linkset: [
      {
        anchor: `${origin}/api/mcp`,
        "service-desc": [
          {
            href: `${origin}/.well-known/mcp/server-card.json`,
            type: "application/json",
            title: "MCP server card",
          },
        ],
        "service-doc": [
          { href: `${origin}/docs`, type: "text/html", title: "curata documentation" },
        ],
        status: [{ href: `${origin}/api/health`, type: "application/json" }],
      },
      {
        anchor: `${origin}/llms.txt`,
        describedby: [
          { href: `${origin}/llms-full.txt`, type: "text/plain", title: "Full public page text" },
        ],
      },
    ],
  };

  return new NextResponse(JSON.stringify(linkset, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/linkset+json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
