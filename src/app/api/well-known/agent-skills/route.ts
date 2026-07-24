import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { pageToMarkdown } from "@/lib/page-markdown";
import { isPack, listPublicPageContent, siteOrigin } from "@/lib/public-catalog";

// Agent Skills discovery index (Cloudflare RFC v0.2.0). Served at
// /.well-known/agent-skills/index.json via a rewrite in next.config.ts.
//
// A public page carrying a `pack:` block is an installable set of rules, which
// is what this index is for. The digest covers the exact markdown served at
// `url`, so a consumer can verify what it fetched.

export const dynamic = "force-dynamic";

const sha256 = (body: string) => createHash("sha256").update(body, "utf8").digest("hex");

const firstLine = (json: Record<string, unknown>): string | undefined => {
  const subtitle = json.subtitle;
  if (typeof subtitle === "string" && subtitle.trim()) return subtitle.trim();
  const pack = json.pack as Record<string, unknown> | undefined;
  const description = pack?.description;
  return typeof description === "string" && description.trim() ? description.trim() : undefined;
};

export async function GET(request: Request) {
  const origin = siteOrigin(request);
  const pages = await listPublicPageContent();

  const skills = pages.filter((p) => isPack(p.json)).map((page) => {
    const url = `${origin}/p/${page.orgSlug}/${page.slug}.md`;
    const markdown = pageToMarkdown(page.json, {
      preamble: `<!-- source: ${origin}/p/${page.orgSlug}/${page.slug} -->`,
    });
    const pack = page.json.pack as Record<string, unknown> | undefined;
    const name = typeof pack?.name === "string" ? pack.name : page.slug;

    return {
      name,
      type: "skill",
      description: firstLine(page.json) ?? page.title,
      url,
      sha256: sha256(markdown),
      updated: page.updatedAt.toISOString(),
      // Installs the pack into CLAUDE.md / AGENTS.md / .cursorrules and keeps
      // it tracked for drift.
      install: `kazam install ${origin}/p/${page.orgSlug}/${page.slug}`,
    };
  });

  return NextResponse.json(
    {
      $schema:
        "https://raw.githubusercontent.com/cloudflare/agent-skills-discovery-rfc/main/schemas/v0.2.0/index.json",
      version: "0.2.0",
      skills,
    },
    { headers: { "Cache-Control": "public, max-age=900" } },
  );
}
