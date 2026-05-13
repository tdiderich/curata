import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { writePageJson } from "@/lib/pages";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const slug = request.nextUrl.searchParams.get("slug");
  if (!slug) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  const version = await db.pageVersion.findFirst({
    where: { page: { orgId: ctx.orgId, slug } },
    orderBy: { createdAt: "desc" },
    select: { contentHash: true },
  });

  if (!version) {
    return NextResponse.json({ error: "page not found" }, { status: 404 });
  }

  return NextResponse.json({ contentHash: version.contentHash });
}

export async function PUT(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      slug?: string;
      json?: Record<string, unknown>;
      expectedHash?: string;
    };

    if (!body.slug || !body.json) {
      return NextResponse.json(
        { error: "slug and json are required" },
        { status: 400 }
      );
    }

    const page = await db.page.findUnique({
      where: { orgId_slug: { orgId: ctx.orgId, slug: body.slug } },
      select: { createdBy: true },
    });

    const isOwner = page?.createdBy === ctx.userId;
    if (!can(ctx.role, "page:edit", isOwner)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const result = await writePageJson(
      ctx.orgId,
      ctx.orgSlug,
      body.slug,
      body.json,
      ctx.userId,
      body.expectedHash
    );

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 409 });
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("pages/content error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
