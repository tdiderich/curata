import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getChart, getChartNode, getNeedsLook, setChartNode } from "@/lib/chart";

/** GET ?term= for one node, ?view=list for needs-look, else the whole chart. PATCH {term, pinned|hidden|promoted}. */
export async function GET(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const term = request.nextUrl.searchParams.get("term");
  const view = request.nextUrl.searchParams.get("view");
  try {
    if (term) return NextResponse.json(await getChartNode(ctx.orgId, term));
    if (view === "list") return NextResponse.json(await getNeedsLook(ctx.orgId));
    return NextResponse.json(await getChart(ctx.orgId, { includeHidden: request.nextUrl.searchParams.get("includeHidden") === "true" }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: msg.startsWith("concept not found") ? 404 : 400 });
  }
}

export async function PATCH(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(ctx.role, "page:edit")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  let body: { term?: string; pinned?: boolean; hidden?: boolean; promoted?: boolean };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); }
  if (!body.term) return NextResponse.json({ error: "term required" }, { status: 400 });
  const patch: { pinned?: boolean; hidden?: boolean; promoted?: boolean } = {};
  for (const k of ["pinned", "hidden", "promoted"] as const) if (typeof body[k] === "boolean") patch[k] = body[k];
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "give at least one of pinned, hidden, promoted" }, { status: 400 });
  try {
    return NextResponse.json(await setChartNode(ctx.orgId, body.term, patch));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: msg.startsWith("concept not found") ? 404 : 400 });
  }
}
