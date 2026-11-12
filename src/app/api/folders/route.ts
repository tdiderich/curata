import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { ownerActionAllowed, pageAccessFor } from "@/lib/access";
import { folderUpdateDenial } from "@/lib/folder-access";

export async function POST(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      name?: string;
      visibility?: string;
      parentId?: string | null;
    };

    if (!body.name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const visibility = body.visibility ?? "org";
    if (visibility !== "private" && visibility !== "org") {
      return NextResponse.json(
        { error: "visibility must be 'private' or 'org'" },
        { status: 400 }
      );
    }

    if (visibility === "org" && !can(ctx.role, "folder:manage")) {
      return NextResponse.json({ error: "forbidden: only owner/admin can create org-visible folders" }, { status: 403 });
    }

    const folder = await db.folder.create({
      data: {
        orgId: ctx.orgId,
        name: body.name,
        visibility,
        createdBy: ctx.userId,
        parentId: body.parentId ?? null,
      },
    });

    return NextResponse.json(folder, { status: 201 });
  } catch (err) {
    console.error("folders error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET() {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const folders = await db.folder.findMany({
      where: {
        orgId: ctx.orgId,
        OR: [
          { visibility: "org" },
          { visibility: "private", createdBy: ctx.userId },
        ],
      },
      orderBy: { name: "asc" },
      include: {
        _count: { select: { children: true, pages: true } },
      },
    });

    return NextResponse.json(
      folders.map((f) => ({
        id: f.id,
        orgId: f.orgId,
        parentId: f.parentId,
        name: f.name,
        visibility: f.visibility,
        createdBy: f.createdBy,
        createdAt: f.createdAt,
        childCount: f._count.children,
        pageCount: f._count.pages,
      }))
    );
  } catch (err) {
    console.error("folders error:", err);
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
      id?: string;
      name?: string;
      parentId?: string | null;
      visibility?: string;
    };

    if (!body.id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const denied = await folderUpdateDenial(ctx.orgId, body.id, ctx.userId, ctx.role === "owner" || ctx.role === "admin", {
      parentId: body.parentId,
      visibility: body.visibility,
    });
    if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status });

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.parentId !== undefined) data.parentId = body.parentId;
    if (body.visibility !== undefined) data.visibility = body.visibility;

    const updated = await db.folder.update({
      where: { id: body.id },
      data,
    });

    return NextResponse.json(updated);
  } catch (err) {
    console.error("folders error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as { id?: string };

    if (!body.id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const folder = await db.folder.findFirst({
      where: { id: body.id, orgId: ctx.orgId },
    });

    if (!folder) {
      return NextResponse.json({ error: "folder not found" }, { status: 404 });
    }

    if (folder.locked) {
      return NextResponse.json({ error: "stock folders cannot be deleted" }, { status: 403 });
    }

    const isCreator = folder.createdBy === ctx.userId;
    const isPrivileged = ctx.role === "owner" || ctx.role === "admin";

    if (folder.visibility === "org" && !isPrivileged) {
      return NextResponse.json(
        { error: "forbidden: only owner/admin can delete org-visible folders" },
        { status: 403 }
      );
    }

    if (folder.visibility === "private" && !isCreator && !isPrivileged) {
      return NextResponse.json(
        { error: "forbidden: only creator can delete private folders" },
        { status: 403 }
      );
    }

    // Deleting a folder deletes everything nested under it — subfolders and
    // their pages — rather than promoting pages to top level.
    const orgFolders = await db.folder.findMany({
      where: { orgId: ctx.orgId },
      select: { id: true, parentId: true },
    });
    const folderIds = new Set<string>([body.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of orgFolders) {
        if (f.parentId && folderIds.has(f.parentId) && !folderIds.has(f.id)) {
          folderIds.add(f.id);
          grew = true;
        }
      }
    }

    // The cascade deletes pages, so it follows the page rules: every private
    // page in the subtree must be one the caller owns. Someone else's private
    // page (hidden, or held through a share) blocks the delete; its owner
    // has to move or delete it first. The message names no page.
    const nested = await db.page.findMany({
      where: { folderId: { in: [...folderIds] }, visibility: "private" },
      select: { id: true, orgId: true, slug: true, visibility: true, createdBy: true },
    });
    for (const p of nested) {
      const access = await pageAccessFor(p, ctx.userId, ctx.role);
      if (!access || !ownerActionAllowed(p, access)) {
        return NextResponse.json(
          { error: "forbidden: this folder holds private pages owned by someone else; they must move or delete them first" },
          { status: 403 }
        );
      }
    }

    await db.$transaction([
      db.page.deleteMany({
        where: { folderId: { in: [...folderIds] } },
      }),
      db.folder.deleteMany({
        where: { id: { in: [...folderIds] } },
      }),
    ]);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("folders error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
