import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { resolveOrg } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { getPageOrThrow, assertPageEditable, PageAccessError } from "@/lib/access";

export async function GET(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!can(ctx.role, "page:edit")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const slug = request.nextUrl.searchParams.get("slug");
  if (!slug) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  try {
    let page;
    try {
      const { id } = await getPageOrThrow(ctx.orgId, slug, ctx.userId, ctx.role);
      page = await db.page.findUniqueOrThrow({ where: { id } });
    } catch (e) {
      if (e instanceof PageAccessError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }

    const versions = await db.pageVersion.findMany({
      where: { pageId: page.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        contentHash: true,
        createdBy: true,
        createdAt: true,
        yamlContent: true,
      },
    });

    return NextResponse.json({ versions, trustedVersionId: page.trustedVersionId });
  } catch (err) {
    console.error("versions error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!can(ctx.role, "page:edit")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { slug, versionId } = body as { slug?: string; versionId?: string };

    if (!slug || !versionId) {
      return NextResponse.json(
        { error: "slug and versionId are required" },
        { status: 400 }
      );
    }

    let page;
    try {
      page = await getPageOrThrow(ctx.orgId, slug, ctx.userId, ctx.role);
      assertPageEditable(page);
    } catch (e) {
      if (e instanceof PageAccessError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }

    const targetVersion = await db.pageVersion.findFirst({
      where: { id: versionId, pageId: page.id },
    });

    if (!targetVersion) {
      return NextResponse.json({ error: "version not found" }, { status: 404 });
    }

    const contentHash = createHash("sha256")
      .update(targetVersion.yamlContent)
      .digest("hex");

    await db.$transaction([
      db.pageVersion.create({
        data: {
          pageId: page.id,
          yamlContent: targetVersion.yamlContent,
          jsonContent: targetVersion.jsonContent ?? undefined,
          contentHash,
          createdBy: ctx.userId,
        },
      }),
      db.page.update({
        where: { id: page.id },
        data: { updatedAt: new Date() },
      }),
    ]);

    return NextResponse.json({ ok: true, contentHash });
  } catch (err) {
    console.error("versions error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
