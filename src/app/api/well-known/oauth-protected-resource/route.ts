import { requestOrigin } from "@/lib/request-origin";

// RFC 9728 protected-resource metadata for the MCP endpoint. Surfaced at
// /.well-known/oauth-protected-resource (and path-suffixed variants like
// /.well-known/oauth-protected-resource/mcp) via rewrites in next.config.ts —
// Next's router ignores a literal `.well-known` directory under app/.
//
// Only meaningful when Clerk is the identity layer: the metadata points MCP
// clients (Claude.ai, ChatGPT connectors) at Clerk's OAuth 2.1 authorization
// server, which handles PKCE, dynamic client registration, and consent.
// Other AUTH_MODEs have no OAuth authorization server, so this 404s.
//
// @clerk/mcp-tools is imported dynamically so deployments that never enter
// clerk mode (the tailscale TS Hub build syncs this source without curata's
// package.json) can build without the package installed.

const AUTH_MODE = process.env.AUTH_MODE ?? "none";

export async function GET(request: Request) {
  if (AUTH_MODE !== "clerk") return new Response(null, { status: 404 });
  const { protectedResourceHandlerClerk } = await import("@clerk/mcp-tools/next");
  // Clerk's handler reads the resource origin off request.url, which behind
  // the proxy is the internal bind address — rewrite it to the public origin.
  const publicUrl = new URL(new URL(request.url).pathname, requestOrigin(request));
  return protectedResourceHandlerClerk({
    scopes_supported: ["email", "profile", "user:org:read"],
  })(new Request(publicUrl, { headers: request.headers }));
}

export async function OPTIONS() {
  if (AUTH_MODE !== "clerk") return new Response(null, { status: 404 });
  const { metadataCorsOptionsRequestHandler } = await import("@clerk/mcp-tools/next");
  return metadataCorsOptionsRequestHandler()();
}
