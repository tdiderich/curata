import { NextRequest, NextResponse } from "next/server";
import { resolveOrg, resolveCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { saveAnnotation, updateAnnotationStatus } from "@/lib/pages";
import { logAudit } from "@/lib/audit";

export async function POST(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!can(ctx.role, "annotate")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { slug, text, section, target, kind, replacement } = body;

    if (!slug || !text) {
      return NextResponse.json(
        { error: "slug and text are required" },
        { status: 400 }
      );
    }

    const user = await resolveCurrentUser();
    const author = user?.name || user?.email || ctx.userId;

    const ann = await saveAnnotation(
      ctx.orgId,
      ctx.orgSlug,
      slug,
      text,
      author,
      section || undefined,
      target || undefined,
      kind || undefined,
      replacement || undefined
    );
    logAudit({
      orgId: ctx.orgId,
      action: "annotation.create",
      resourceType: "annotation",
      resourceId: (ann as { id?: string }).id ?? slug,
      actorType: "user",
      actorId: ctx.userId,
      metadata: { slug, section, kind },
    });
    return NextResponse.json(ann, { status: 201 });
  } catch (err) {
    console.error("annotations error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!can(ctx.role, "annotate")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { slug, id, status } = body;

    if (!slug || !id || !status) {
      return NextResponse.json(
        { error: "slug, id, and status are required" },
        { status: 400 }
      );
    }

    if (
      status !== "approved" &&
      status !== "incorporated" &&
      status !== "ignored"
    ) {
      return NextResponse.json(
        { error: "status must be 'approved', 'incorporated', or 'ignored'" },
        { status: 400 }
      );
    }

    const updated = await updateAnnotationStatus(
      ctx.orgId,
      ctx.orgSlug,
      slug,
      id,
      status
    );
    if (!updated) {
      return NextResponse.json(
        { error: "annotation not found" },
        { status: 404 }
      );
    }
    logAudit({
      orgId: ctx.orgId,
      action: "annotation.update",
      resourceType: "annotation",
      resourceId: id,
      actorType: "user",
      actorId: ctx.userId,
      metadata: { slug, status },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("annotations error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
