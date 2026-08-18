import { NextRequest, NextResponse } from "next/server";
import yaml from "js-yaml";
import { resolveOrg } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { readPageYaml, writePage, markTrusted } from "@/lib/pages";
import { db } from "@/lib/db";
import { resolveEffectiveTrustMode, canApprove } from "@/lib/approval";

export async function GET(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const slug = request.nextUrl.searchParams.get("slug");
  if (!slug) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  const page = await readPageYaml(ctx.orgId, slug);
  if (!page) {
    return NextResponse.json({ error: "page not found" }, { status: 404 });
  }

  return NextResponse.json({ yaml: page.yaml, contentHash: page.contentHash });
}

export async function PUT(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      slug?: string;
      yaml?: string;
      expectedHash?: string;
      autoTrust?: boolean;
    };

    if (!body.slug || !body.yaml) {
      return NextResponse.json(
        { error: "slug and yaml are required" },
        { status: 400 },
      );
    }

    try {
      yaml.load(body.yaml);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "invalid YAML";
      return NextResponse.json({ error: `YAML parse error: ${msg}` }, { status: 400 });
    }

    const page = await db.page.findUnique({
      where: { orgId_slug: { orgId: ctx.orgId, slug: body.slug } },
      select: { createdBy: true },
    });

    const isOwner = page?.createdBy === ctx.userId;
    if (!can(ctx.role, "page:edit", isOwner)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const result = await writePage(
      ctx.orgId,
      ctx.orgSlug,
      body.slug,
      body.yaml,
      ctx.userId,
      body.expectedHash,
    );

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 409 });
    }

    if (body.autoTrust) {
      const pageRow = await db.page.findUnique({
        where: { orgId_slug: { orgId: ctx.orgId, slug: body.slug } },
        select: { folderId: true, rules: true },
      });
      if (pageRow) {
        const trustMode = (await resolveEffectiveTrustMode(ctx.orgId, pageRow.folderId, pageRow.rules)).mode;
        if (trustMode === "locked") {
          const eligible = await canApprove(ctx.orgId, ctx.userId, ctx.role, body.slug);
          if (eligible) {
            const latestVersion = await db.pageVersion.findFirst({
              where: { page: { orgId: ctx.orgId, slug: body.slug } },
              orderBy: { createdAt: "desc" },
              select: { id: true },
            });
            if (latestVersion) await markTrusted(ctx.orgId, body.slug, latestVersion.id, ctx.userId);
          }
        }
      }
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("pages/yaml error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
