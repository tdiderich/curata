import { NextResponse } from "next/server";
import { resolveOrg } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { backfillScan } from "@/lib/scan";

/** POST: rescan every live page for embeds and external URLs. */
export async function POST() {
  const ctx = await resolveOrg();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(ctx.role, "page:edit")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json(await backfillScan(ctx.orgId, ctx.userId));
}
