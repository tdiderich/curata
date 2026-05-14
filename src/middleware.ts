import { NextRequest, NextResponse } from "next/server";

const AUTH_MODE = process.env.AUTH_MODE ?? "none";

const RATE_LIMIT_WINDOW = 60_000;
const RATE_LIMIT_MAX = 120;
const agentHits = new Map<string, { count: number; reset: number }>();

const PROTECTED_PREFIXES = ["/dashboard", "/settings"];
const PUBLIC_PREFIXES = [
  "/sign-in",
  "/api/auth/",
  "/api/mcp/",
  "/api/og/",
  "/api/public-annotations/",
  "/p/",
];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
}

function isPublic(pathname: string): boolean {
  if (pathname === "/" || pathname === "/sign-in") return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

function isAgentApi(pathname: string): boolean {
  return pathname.startsWith("/api/mcp");
}

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Rate limiting for /api/mcp
  if (isAgentApi(pathname)) {
    const key =
      request.headers.get("authorization")?.slice(0, 20) ||
      request.headers.get("x-forwarded-for") ||
      "anon";
    const now = Date.now();
    const entry = agentHits.get(key);
    if (!entry || now > entry.reset) {
      if (agentHits.size > 10_000) {
        for (const [k, v] of agentHits) {
          if (now > v.reset) agentHits.delete(k);
        }
      }
      agentHits.set(key, { count: 1, reset: now + RATE_LIMIT_WINDOW });
    } else {
      entry.count++;
      if (entry.count > RATE_LIMIT_MAX) {
        return NextResponse.json(
          { error: "rate limit exceeded" },
          { status: 429, headers: { "Retry-After": "60" } },
        );
      }
    }
  }

  // Auth enforcement for oauth mode
  if (AUTH_MODE === "oauth" && isProtected(pathname) && !isPublic(pathname)) {
    // Check for next-auth session token cookie
    const sessionToken =
      request.cookies.get("next-auth.session-token")?.value ||
      request.cookies.get("__Secure-next-auth.session-token")?.value;

    if (!sessionToken) {
      const signInUrl = new URL("/sign-in", request.url);
      return NextResponse.redirect(signInUrl);
    }
  }

  const response = NextResponse.next();

  // Security headers
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains; preload",
  );

  const isDev = request.headers.get("host")?.includes("localhost");
  response.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://challenges.cloudflare.com https://static.cloudflareinsights.com`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      `connect-src 'self' https://cloudflareinsights.com`,
      `frame-src https://challenges.cloudflare.com`,
      "worker-src 'self' blob:",
    ].join("; "),
  );

  return response;
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|mp4|webm|ogg|mp3|wav)).*)",
    "/(api|trpc)(.*)",
  ],
};
