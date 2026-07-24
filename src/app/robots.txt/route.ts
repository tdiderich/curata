import { NextResponse } from "next/server";
import { siteOrigin } from "@/lib/public-catalog";

// Served by the app rather than injected at the edge, so the policy is
// version-controlled and the same on curata.ai and every self-hosted instance.
//
// Content-Signal is the machine-readable statement of intent (see
// contentsignals.org): search and reference use are allowed, training is not.
// It expresses a preference, not an enforcement — blocking is a separate edge
// concern.

export const dynamic = "force-dynamic";

const TRAINING_CRAWLERS = [
  "Amazonbot",
  "Applebot-Extended",
  "Bytespider",
  "CCBot",
  "ClaudeBot",
  "Google-Extended",
  "GPTBot",
  "meta-externalagent",
];

export async function GET(request: Request) {
  const origin = siteOrigin(request);

  const lines = [
    "# curata — see /llms.txt for an agent-readable index of public pages.",
    "",
    "User-agent: *",
    "Content-Signal: search=yes,ai-train=no,use=reference",
    "Allow: /p/",
    "Disallow: /dashboard",
    "Disallow: /settings",
    "Disallow: /api/",
    "Disallow: /sign-in",
    "Disallow: /export-preview/",
    "",
    "# Agents acting for a person reading a specific page are welcome on public",
    "# pages. Bulk collection for model training is not.",
    ...TRAINING_CRAWLERS.flatMap((ua) => [`User-agent: ${ua}`, "Disallow: /", ""]),
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ];

  return new NextResponse(lines.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
