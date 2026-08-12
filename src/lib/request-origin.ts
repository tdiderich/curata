/**
 * The externally visible origin of a request. Behind Railway's proxy,
 * `new URL(request.url).origin` yields the internal bind address
 * (0.0.0.0:8080), which is useless in OAuth discovery documents and
 * WWW-Authenticate challenges — prefer the forwarded headers.
 */
export function requestOrigin(request: Request): string {
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return new URL(request.url).origin;
  const proto =
    request.headers.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}
