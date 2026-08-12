import {
  protectedResourceHandlerClerk,
  metadataCorsOptionsRequestHandler,
} from "@clerk/mcp-tools/next";

// RFC 9728 protected-resource metadata for the MCP endpoint. Surfaced at
// /.well-known/oauth-protected-resource (and path-suffixed variants like
// /.well-known/oauth-protected-resource/mcp) via rewrites in next.config.ts —
// Next's router ignores a literal `.well-known` directory under app/.
//
// Only meaningful when Clerk is the identity layer: the metadata points MCP
// clients (Claude.ai, ChatGPT connectors) at Clerk's OAuth 2.1 authorization
// server, which handles PKCE, dynamic client registration, and consent.
// Other AUTH_MODEs have no OAuth authorization server, so this 404s.

const AUTH_MODE = process.env.AUTH_MODE ?? "none";

export async function GET(request: Request) {
  if (AUTH_MODE !== "clerk") return new Response(null, { status: 404 });
  return protectedResourceHandlerClerk({
    scopes_supported: ["email", "profile", "user:org:read"],
  })(request);
}

export async function OPTIONS() {
  if (AUTH_MODE !== "clerk") return new Response(null, { status: 404 });
  return metadataCorsOptionsRequestHandler()();
}
