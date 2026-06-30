import { NextRequest, NextResponse } from "next/server";
import yaml from "js-yaml";
import { resolveOrg } from "@/lib/auth";
import { can, VALID_PAGE_VISIBILITY } from "@/lib/permissions";
import { db } from "@/lib/db";
import { writePageJson } from "@/lib/pages";
import { getTemplateContent } from "@/lib/templates-server";
import { getPageOrThrow, PageAccessError, checkFolderBoundary } from "@/lib/access";

export async function POST(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!can(ctx.role, "page:create")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const body = (await request.json()) as {
      title?: string;
      slug?: string;
      shell?: string;
      templateSlug?: string;
    };

    if (!body.title?.trim()) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    const slug =
      body.slug?.trim() ||
      body.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

    const existing = await db.page.findUnique({
      where: { orgId_slug: { orgId: ctx.orgId, slug } },
    });
    if (existing) {
      return NextResponse.json(
        { error: "a page with this slug already exists" },
        { status: 409 }
      );
    }

    let json: Record<string, unknown>;

    if (body.templateSlug) {
      const templateContent = getTemplateContent(body.templateSlug);
      if (!templateContent) {
        return NextResponse.json(
          { error: `template not found: ${body.templateSlug}` },
          { status: 400 }
        );
      }
      json = yaml.load(templateContent) as Record<string, unknown>;
      json.title = body.title.trim();
    } else {
      json = {
        title: body.title.trim(),
        shell: body.shell || "standard",
        components: [],
      };
    }

    const result = await writePageJson(ctx.orgId, ctx.orgSlug, slug, json, ctx.userId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({ ok: true, slug: result.slug });
  } catch (err) {
    console.error("pages error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    let slug = url.searchParams.get("slug");
    if (!slug) {
      const body = (await request.json().catch(() => ({}))) as { slug?: string };
      slug = body.slug ?? null;
    }

    if (!slug) {
      return NextResponse.json({ error: "slug is required" }, { status: 400 });
    }

    let pageWithAccess;
    try {
      pageWithAccess = await getPageOrThrow(ctx.orgId, slug, ctx.userId, ctx.role);
    } catch (e) {
      if (e instanceof PageAccessError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }

    const isOwner = pageWithAccess.createdBy === ctx.userId || pageWithAccess.createdBy === "default";
    if (!can(ctx.role, "page:delete", isOwner)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    await db.page.delete({ where: { id: pageWithAccess.id } });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("pages error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      slug?: string;
      folderId?: string | null;
      visibility?: string;
      pinned?: boolean;
      status?: string;
    };

    if (!body.slug) {
      return NextResponse.json({ error: "slug is required" }, { status: 400 });
    }

    let pageWithAccess;
    try {
      pageWithAccess = await getPageOrThrow(ctx.orgId, body.slug, ctx.userId, ctx.role);
    } catch (e) {
      if (e instanceof PageAccessError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }

    if (!can(ctx.role, "page:edit", pageWithAccess.createdBy === ctx.userId)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    if (body.visibility !== undefined) {
      if (!(VALID_PAGE_VISIBILITY as readonly string[]).includes(body.visibility)) {
        return NextResponse.json(
          { error: `visibility must be one of: ${VALID_PAGE_VISIBILITY.join(", ")}` },
          { status: 400 }
        );
      }
    }

    const effectiveVis = body.visibility ?? pageWithAccess.visibility ?? "org";
    if (body.folderId) {
      const folder = await db.folder.findFirst({ where: { id: body.folderId, orgId: ctx.orgId } });
      if (folder) {
        try { checkFolderBoundary(effectiveVis, folder.visibility); } catch (e) {
          return NextResponse.json({ error: (e as Error).message }, { status: 400 });
        }
      }
    } else if (body.visibility !== undefined) {
      const currentPage = await db.page.findUnique({
        where: { id: pageWithAccess.id },
        select: { folderId: true, folder: { select: { visibility: true } } },
      });
      if (currentPage?.folder) {
        try { checkFolderBoundary(body.visibility, currentPage.folder.visibility); } catch (e) {
          return NextResponse.json({ error: (e as Error).message }, { status: 400 });
        }
      }
    }

    const data: Record<string, unknown> = {};
    if (body.folderId !== undefined) data.folderId = body.folderId;
    if (body.visibility !== undefined) data.visibility = body.visibility;
    if (body.pinned !== undefined) data.pinned = body.pinned;
    if (body.status !== undefined) {
      if (body.status !== "active" && body.status !== "archived") {
        return NextResponse.json(
          { error: "status must be 'active' or 'archived'" },
          { status: 400 }
        );
      }
      data.status = body.status;
      if (body.status === "active") data.supersededBy = null;
    }

    const updated = await db.page.update({
      where: { id: pageWithAccess.id },
      data,
    });

    return NextResponse.json({ ok: true, slug: updated.slug });
  } catch (err) {
    console.error("pages error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
