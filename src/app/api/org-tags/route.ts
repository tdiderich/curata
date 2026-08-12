import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { extractOrgTags, withOrgTags } from "@/lib/org-tags";
import type { Prisma } from "@/generated/prisma/client";

/** Blessed organization tags: read for anyone in the org. */
export async function GET() {
  const ctx = await resolveOrg();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const org = await db.organization.findUnique({
    where: { id: ctx.orgId },
    select: { rules: true },
  });
  return NextResponse.json({ tags: extractOrgTags(org?.rules) });
}

/** Replace the blessed list. Owners/admins only (same gate as content rules). */
export async function PUT(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(ctx.role, "rules:manage")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: { tags?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.tags) || body.tags.some((t) => typeof t !== "string")) {
    return NextResponse.json({ error: "tags must be an array of strings" }, { status: 400 });
  }
  if (body.tags.length > 100) {
    return NextResponse.json({ error: "too many tags (max 100)" }, { status: 400 });
  }

  const org = await db.organization.findUnique({
    where: { id: ctx.orgId },
    select: { rules: true },
  });
  const updated = withOrgTags(org?.rules, body.tags as string[]);
  await db.organization.update({
    where: { id: ctx.orgId },
    data: { rules: updated as Prisma.InputJsonValue },
  });

  return NextResponse.json({ tags: extractOrgTags(updated) });
}
