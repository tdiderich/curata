import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { readPageYaml, writePage } from "@/lib/pages";
import { db } from "@/lib/db";

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findInYaml(yaml: string, target: string): string | null {
  const lines = target.split("\n");
  if (lines.length <= 1) return null;
  const pattern = new RegExp(
    lines.map((l) => escapeRegex(l.trimStart())).join("\\n\\s*"),
  );
  const m = yaml.match(pattern);
  return m ? m[0] : null;
}

export async function POST(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { slug, target, replacement } = body;

    if (!slug || !target || !replacement) {
      return NextResponse.json(
        { error: "slug, target, and replacement are required" },
        { status: 400 }
      );
    }

    const pageMeta = await db.page.findUnique({
      where: { orgId_slug: { orgId: ctx.orgId, slug } },
      select: { createdBy: true },
    });

    const isOwner = pageMeta?.createdBy === ctx.userId;
    if (!can(ctx.role, "page:edit", isOwner)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const page = await readPageYaml(ctx.orgId, slug);
    if (!page) {
      return NextResponse.json(
        { error: "page not found" },
        { status: 404 }
      );
    }

    let yamlTarget = target;
    if (!page.yaml.includes(target)) {
      const found = findInYaml(page.yaml, target);
      if (!found) {
        return NextResponse.json(
          { error: "target text not found in page source" },
          { status: 404 }
        );
      }
      yamlTarget = found;
    }

    const occurrences = page.yaml.split(yamlTarget).length - 1;
    if (occurrences > 1) {
      return NextResponse.json(
        { error: `target text is ambiguous — found ${occurrences} occurrences` },
        { status: 409 }
      );
    }

    const newContent = page.yaml.replace(yamlTarget, replacement);
    const result = await writePage(ctx.orgId, ctx.orgSlug, slug, newContent, "web", page.contentHash);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 409 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("edit error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
