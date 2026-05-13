import { NextRequest, NextResponse } from "next/server";
import yaml from "js-yaml";
import { resolveOrg } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { writePageJson } from "@/lib/pages";
import { getTemplateContent } from "@/lib/templates-server";

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

    const page = await db.page.findUnique({
      where: { orgId_slug: { orgId: ctx.orgId, slug } },
    });

    if (!page) {
      return NextResponse.json({ error: "page not found" }, { status: 404 });
    }

    if (!can(ctx.role, "page:delete", page.createdBy === ctx.userId)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    await db.page.delete({ where: { id: page.id } });

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
    };

    if (!body.slug) {
      return NextResponse.json({ error: "slug is required" }, { status: 400 });
    }

    const page = await db.page.findUnique({
      where: { orgId_slug: { orgId: ctx.orgId, slug: body.slug } },
    });

    if (!page) {
      return NextResponse.json({ error: "page not found" }, { status: 404 });
    }

    if (!can(ctx.role, "page:edit", page.createdBy === ctx.userId)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    if (body.visibility !== undefined) {
      const allowed = ["personal", "shared", "public"];
      if (!allowed.includes(body.visibility)) {
        return NextResponse.json(
          { error: "visibility must be personal, shared, or public" },
          { status: 400 }
        );
      }
    }

    const data: Record<string, unknown> = {};
    if (body.folderId !== undefined) data.folderId = body.folderId;
    if (body.visibility !== undefined) data.visibility = body.visibility;

    const updated = await db.page.update({
      where: { id: page.id },
      data,
    });

    return NextResponse.json({ ok: true, slug: updated.slug });
  } catch (err) {
    console.error("pages error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
