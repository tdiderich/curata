import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";

const MAX_BYTES = 512 * 1024;
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/svg+xml", "image/webp"]);

export async function POST(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!can(ctx.role, "member:manage")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart form data with a 'file' field" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing 'file' field" }, { status: 400 });
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: "logo must be PNG, JPEG, SVG, or WebP" },
      { status: 400 }
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "logo must be under 512KB" }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  await db.organization.update({
    where: { id: ctx.orgId },
    data: { logoData: bytes, logoMime: file.type },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!can(ctx.role, "member:manage")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await db.organization.update({
    where: { id: ctx.orgId },
    data: { logoData: null, logoMime: null },
  });

  return NextResponse.json({ ok: true });
}
