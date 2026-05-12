import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";

export async function POST(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    action: string;
    slugs: string[];
    folderId?: string | null;
    visibility?: string;
  };

  if (!Array.isArray(body.slugs) || body.slugs.length === 0) {
    return NextResponse.json({ error: "slugs required" }, { status: 400 });
  }

  if (body.slugs.length > 100) {
    return NextResponse.json({ error: "max 100 pages per request" }, { status: 400 });
  }

  const pages = await db.page.findMany({
    where: { orgId: ctx.orgId, slug: { in: body.slugs } },
  });

  if (pages.length === 0) {
    return NextResponse.json({ error: "no matching pages" }, { status: 404 });
  }

  switch (body.action) {
    case "delete": {
      const deletable = pages.filter((p) =>
        can(ctx.role, "page:delete", p.createdBy === ctx.userId)
      );
      if (deletable.length === 0) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
      await db.page.deleteMany({
        where: { id: { in: deletable.map((p) => p.id) } },
      });
      return NextResponse.json({ ok: true, affected: deletable.length });
    }

    case "move": {
      const editable = pages.filter((p) =>
        can(ctx.role, "page:edit", p.createdBy === ctx.userId)
      );
      if (editable.length === 0) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
      await db.page.updateMany({
        where: { id: { in: editable.map((p) => p.id) } },
        data: { folderId: body.folderId ?? null },
      });
      return NextResponse.json({ ok: true, affected: editable.length });
    }

    case "visibility": {
      const allowed = ["personal", "shared", "public"];
      if (!body.visibility || !allowed.includes(body.visibility)) {
        return NextResponse.json(
          { error: "visibility must be personal, shared, or public" },
          { status: 400 }
        );
      }
      const editable = pages.filter((p) =>
        can(ctx.role, "page:edit", p.createdBy === ctx.userId)
      );
      if (editable.length === 0) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
      await db.page.updateMany({
        where: { id: { in: editable.map((p) => p.id) } },
        data: { visibility: body.visibility },
      });
      return NextResponse.json({ ok: true, affected: editable.length });
    }

    default:
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
}
