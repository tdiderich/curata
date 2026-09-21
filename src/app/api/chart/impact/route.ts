import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/auth";
import { getPageImpact } from "@/lib/chart";

/** GET ?slug= : what a write to this page turns yellow. Backs the post-save toast. */
export async function GET(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const slug = request.nextUrl.searchParams.get("slug");
  if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });
  return NextResponse.json(await getPageImpact(ctx.orgId, slug));
}
