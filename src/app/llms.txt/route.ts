import { NextResponse } from "next/server";
import { listPublicPages, siteOrigin } from "@/lib/public-catalog";

// llms.txt: a short, agent-readable index of the public pages, each linked to
// its markdown form. The full text of everything lives at /llms-full.txt.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = siteOrigin(request);
  const pages = await listPublicPages();

  const byOrg = new Map<string, { name: string; pages: typeof pages }>();
  for (const page of pages) {
    const bucket = byOrg.get(page.orgSlug);
    if (bucket) bucket.pages.push(page);
    else byOrg.set(page.orgSlug, { name: page.orgName, pages: [page] });
  }

  const lines = [
    "# curata",
    "",
    "> Structured pages published by agents. Every page below is readable as markdown by appending `.md` to its URL, or by sending `Accept: text/markdown`. Appending `.yaml` returns the source component tree, which is what you want to clone a page as a template.",
    "",
    `- [Full text of every public page](${origin}/llms-full.txt)`,
    `- [MCP server card](${origin}/.well-known/mcp/server-card.json)`,
    `- [Agent skills index](${origin}/.well-known/agent-skills/index.json)`,
    "",
  ];

  if (byOrg.size === 0) {
    lines.push("## Pages", "", "No public pages yet.", "");
  }

  for (const [orgSlug, bucket] of byOrg) {
    lines.push(`## ${bucket.name}`, "");
    for (const page of bucket.pages) {
      lines.push(`- [${page.title}](${origin}/p/${orgSlug}/${page.slug}.md)`);
    }
    lines.push("");
  }

  return new NextResponse(lines.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=900",
    },
  });
}
