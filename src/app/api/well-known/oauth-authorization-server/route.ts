// RFC 8414 authorization-server metadata, proxied from Clerk's frontend API.
// Compatibility shim: spec-current MCP clients read the authorization server
// from the protected-resource metadata and fetch Clerk's own well-known URL
// directly, but some clients still expect AS metadata on the resource origin.
// Surfaced at /.well-known/oauth-authorization-server via next.config.ts
// rewrites. Clerk-mode only; @clerk/mcp-tools is imported dynamically so
// non-clerk deployments build without the package (see the PRM route).

const AUTH_MODE = process.env.AUTH_MODE ?? "none";

export async function GET() {
  if (AUTH_MODE !== "clerk") return new Response(null, { status: 404 });
  const { authServerMetadataHandlerClerk } = await import("@clerk/mcp-tools/next");
  return authServerMetadataHandlerClerk()();
}

export async function OPTIONS() {
  if (AUTH_MODE !== "clerk") return new Response(null, { status: 404 });
  const { metadataCorsOptionsRequestHandler } = await import("@clerk/mcp-tools/next");
  return metadataCorsOptionsRequestHandler()();
}
