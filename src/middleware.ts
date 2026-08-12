import { NextRequest, NextResponse } from "next/server";
import { PUBLIC_PAGE_PATH, negotiateTarget } from "@/lib/content-negotiation";

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
  // Agent-discovery surfaces. These describe only public content and must stay
  // reachable without auth in every AUTH_MODE, the same way robots.txt is.
  "/robots.txt",
  "/sitemap.xml",
  "/llms.txt",
  "/llms-full.txt",
  "/.well-known/",
  "/api/well-known/",
  // Generic agent documentation (AGL execution semantics, agents reference) —
  // fetched by unauthenticated MCP clients following the server instructions.
  "/api/docs/",
  "/mcp",
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

function isPublic(pathname: string, searchParams?: URLSearchParams): boolean {
  if (pathname === "/" || pathname === "/sign-in") return true;
  // Bare /api/mcp (the REST shim) — the "/api/mcp/" prefix below only matches
  // subroutes, which left the shim auth-walled on clerk deployments.
  if (pathname === "/api/mcp") return true;
  if (pathname.startsWith("/export-preview/") && searchParams?.has("nonce")) return true;
  const prefixes = AUTH_MODE === "clerk" ? PUBLIC_PREFIXES_CLERK : PUBLIC_PREFIXES_BASE;
  return prefixes.some((p) => pathname.startsWith(p));
}

function isAgentApi(pathname: string): boolean {
  // /mcp is the short alias rewritten to /api/mcp; it must be rate limited too.
  return pathname.startsWith("/api/mcp") || pathname === "/mcp" || pathname.startsWith("/mcp/");
}

/**
 * Serves the agent-readable representations of a public page from its own URL:
 * a `.md` / `.yaml` suffix, or `Accept: text/markdown` / `Accept:
 * application/yaml` on the page path itself. HTML stays the default for
 * browsers, and the auth gate is unchanged — both targets re-check visibility.
 */
function negotiatedRewrite(request: NextRequest): URL | null {
  const target = negotiateTarget(request.nextUrl.pathname, request.headers.get("accept"));
  if (!target) return null;
  const url = request.nextUrl.clone();
  url.pathname = target;
  return url;
}

/**
 * Advertises the alternate representations on the HTML page response, and marks
 * it as varying by Accept so a cache never serves markdown to a browser.
 */
function applyAgentHeaders(request: NextRequest, response: NextResponse): void {
  const { pathname } = request.nextUrl;
  if (pathname === "/") {
    response.headers.set(
      "Link",
      [
        '</.well-known/api-catalog>; rel="api-catalog"',
        '</llms.txt>; rel="alternate"; type="text/plain"',
        '</.well-known/mcp/server-card.json>; rel="service-desc"',
      ].join(", "),
    );
    return;
  }
  if (!PUBLIC_PAGE_PATH.test(pathname)) return;
  // Vary: Accept is set in next.config.ts — Next overwrites it here.
  response.headers.set(
    "Link",
    [
      `<${pathname}.md>; rel="alternate"; type="text/markdown"`,
      `<${pathname}.yaml>; rel="alternate"; type="application/yaml"`,
    ].join(", "),
  );
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
  response.headers.set("X-Frame-Options", "SAMEORIGIN");
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
      `frame-src 'self'${clerkFrame} https://challenges.cloudflare.com`,
      "worker-src 'self' blob:",
    ].join("; "),
  );
}

async function middlewareClerk(request: NextRequest) {
  const { clerkMiddleware, createRouteMatcher } = await import("@clerk/nextjs/server");
  const isPublicRoute = createRouteMatcher(
    // Bare "/api/mcp" needs an exact entry: the "/api/mcp/" prefix expands to
    // "/api/mcp/(.*)" which only matches subroutes (kz-0e26, same bug the
    // isPublic() exact-match fixed for the non-clerk branches).
    PUBLIC_PREFIXES_CLERK.map((p) => `${p}(.*)`).concat(["/", "/sign-in(.*)", "/api/mcp"])
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

    const isNonceExport = req.nextUrl.pathname.startsWith("/export-preview/") && req.nextUrl.searchParams.has("nonce");
    if (!isPublicRoute(req) && !isNonceExport) {
      await auth.protect();
    }

    if (isAgentApi(req.nextUrl.pathname)) {
      const limited = applyRateLimit(req);
      if (limited) return limited;
    }

    const response = NextResponse.next();
    applySecurityHeaders(req, response);
    applyAgentHeaders(req, response);
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
  applyAgentHeaders(request, response);
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

  // Content negotiation runs before the auth branches: /p/ is public in every
  // mode, and both rewrite targets re-check page visibility themselves.
  const rewriteTo = negotiatedRewrite(request);
  if (rewriteTo) {
    const rewritten = NextResponse.rewrite(rewriteTo);
    applySecurityHeaders(request, rewritten);
    return rewritten;
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
