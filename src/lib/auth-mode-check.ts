/**
 * Startup check for the AUTH_MODE default. An unset AUTH_MODE falls back to
 * "none", which makes every route, /api/mcp included, unauthenticated with
 * full read/write on the first org. That default is right for local dev and
 * self-hosting behind a trusted network, so it stays; but a production build
 * that never set AUTH_MODE is far more likely a missed env var than a choice,
 * so say so loudly. Setting AUTH_MODE=none explicitly silences the warning.
 */
export function authModeStartupWarning(env: Record<string, string | undefined>): string | null {
  if (env.NODE_ENV !== "production") return null;
  if (env.AUTH_MODE !== undefined && env.AUTH_MODE !== "") return null;
  return (
    "[curata] AUTH_MODE is not set, so it defaults to \"none\": every request, " +
    "including /api/mcp and /api/mcp/stream, is unauthenticated with full read/write " +
    "access. Set AUTH_MODE to tailscale, oauth or clerk, or set AUTH_MODE=none " +
    "explicitly if this deployment is only reachable from a trusted network."
  );
}
