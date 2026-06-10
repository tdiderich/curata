import { NextRequest, NextResponse } from "next/server";

const AUTH_MODE = process.env.AUTH_MODE ?? "none";

const RATE_LIMIT_WINDOW = 60_000;
const RATE_LIMIT_MAX = 120;
const agentHits = new Map<string, { count: number; reset: number }>();

const PROTECTED_PREFIXES = ["/dashboard", "/settings"];

const PUBLIC_PREFIXES_BASE = [
  "/sign-in",
  "/api/auth/",
  "/api/mcp/",
  "/api/og/",
  "/api/public-annotations/",
  "/p/",
];

const PUBLIC_PREFIXES_CLERK = [
  ...PUBLIC_PREFIXES_BASE,
  "/sign-up",
  "/api/webhooks/",
  "/api/playground/",
  "/docs",
  "/try",
  "/playground",
  "/privacy",
  "/terms",
];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
}

function isPublic(pathname: string): boolean {
  if (pathname === "/" || pathname === "/sign-in") return true;
  const prefixes = AUTH_MODE === "clerk" ? PUBLIC_PREFIXES_CLERK : PUBLIC_PREFIXES_BASE;
  return prefixes.some((p) => pathname.startsWith(p));
}

function isAgentApi(pathname: string): boolean {
  return pathname.startsWith("/api/mcp");
}

function applyRateLimit(request: NextRequest): NextResponse | null {
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
  return null;
}

function applySecurityHeaders(request: NextRequest, response: NextResponse): void {
  if (process.env.NODE_ENV === "development") return;
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

  const isDev = request.headers.get("host")?.includes("localhost") || (process.env.NODE_ENV as string) === "development";
  const clerkDomains = AUTH_MODE === "clerk"
    ? isDev
      ? " https://*.clerk.accounts.dev"
      : " https://accounts.curata.ai https://clerk.curata.ai"
    : "";
  const clerkImg = AUTH_MODE === "clerk" ? " https://*.clerk.com https://img.clerk.com" : "";
  const clerkFrame = AUTH_MODE === "clerk"
    ? isDev
      ? " https://*.clerk.accounts.dev"
      : " https://accounts.curata.ai"
    : "";

  response.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}${clerkDomains} https://challenges.cloudflare.com https://static.cloudflareinsights.com`,
      "style-src 'self' 'unsafe-inline'",
      `img-src 'self' data: blob:${clerkImg}`,
      "font-src 'self' data:",
      `connect-src 'self'${clerkDomains}${AUTH_MODE === "clerk" ? " https://*.clerk.com" : ""} https://cloudflareinsights.com`,
      `frame-src${clerkFrame} https://challenges.cloudflare.com`,
      "worker-src 'self' blob:",
    ].join("; "),
  );
}

async function middlewareClerk(request: NextRequest) {
  const { clerkMiddleware, createRouteMatcher } = await import("@clerk/nextjs/server");
  const isPublicRoute = createRouteMatcher(
    PUBLIC_PREFIXES_CLERK.map((p) => `${p}(.*)`).concat(["/", "/sign-in(.*)"])
  );

  const handler = clerkMiddleware(async (auth, req) => {
    // Signed-in users land on the dashboard; signed-out users get the root
    // page (deployments overlay a marketing landing there).
    if (req.nextUrl.pathname === "/") {
      const { userId } = await auth();
      if (userId) {
        return NextResponse.redirect(new URL("/dashboard", req.url));
      }
    }

    if (!isPublicRoute(req)) {
      await auth.protect();
    }

    if (isAgentApi(req.nextUrl.pathname)) {
      const limited = applyRateLimit(req);
      if (limited) return limited;
    }

    const response = NextResponse.next();
    applySecurityHeaders(req, response);
    return response;
  });

  return await handler(request, { waitUntil: () => {} } as never);
}

async function middlewareDefault(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isAgentApi(pathname)) {
    const limited = applyRateLimit(request);
    if (limited) return limited;
  }

  if (AUTH_MODE === "tailscale" && isProtected(pathname) && !isPublic(pathname)) {
    const tsLogin = request.headers.get("tailscale-user-login");
    const hasDevFallback = process.env.NODE_ENV === "development" && process.env.TAILSCALE_DEV_USER;
    if (!tsLogin && !hasDevFallback) {
      return NextResponse.json(
        { error: "Tailscale identity required. Access this app through your tailnet." },
        { status: 401 },
      );
    }
  }

  if (AUTH_MODE === "oauth" && isProtected(pathname) && !isPublic(pathname)) {
    const sessionToken =
      request.cookies.get("next-auth.session-token")?.value ||
      request.cookies.get("__Secure-next-auth.session-token")?.value;

    if (!sessionToken) {
      return NextResponse.redirect(new URL("/sign-in", request.url));
    }
  }

  const response = NextResponse.next();
  applySecurityHeaders(request, response);
  return response;
}

export default async function middleware(request: NextRequest) {
  // Clerk mode handles "/" inside middlewareClerk so signed-out visitors can
  // see the marketing landing instead of bouncing through /dashboard → sign-in.
  if (request.nextUrl.pathname === "/" && AUTH_MODE !== "clerk") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  if (request.nextUrl.pathname === "/api/health") {
    return NextResponse.next();
  }
  if (AUTH_MODE === "clerk") return middlewareClerk(request);
  return middlewareDefault(request);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|mp4|webm|ogg|mp3|wav)).*)",
    "/(api|trpc)(.*)",
  ],
};
