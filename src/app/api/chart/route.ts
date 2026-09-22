import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { createNode, getChart, getChartNode, getNeedsLook, promotePageToNode, setChartNode, setSourceStatus } from "@/lib/chart";

/** GET ?term= for one node, ?view=list for needs-look, else the whole chart. PATCH {term, hidden|promoted|instructions}. */
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
  let body: { term?: string; hidden?: boolean; promoted?: boolean; instructions?: string | null; status?: string | null };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); }
  if (!body.term) return NextResponse.json({ error: "term required" }, { status: 400 });
  const patch: { hidden?: boolean; promoted?: boolean; instructions?: string | null } = {};
  for (const k of ["hidden", "promoted"] as const) if (typeof body[k] === "boolean") patch[k] = body[k];
  if (typeof body.instructions === "string" || body.instructions === null) patch.instructions = body.instructions;
  const hasStatus = typeof body.status === "string" || body.status === null;
  if (Object.keys(patch).length === 0 && !hasStatus) return NextResponse.json({ error: "give at least one of hidden, promoted, instructions, status" }, { status: 400 });
  try {
    if (hasStatus) await setSourceStatus(ctx.orgId, ctx.orgSlug, body.term, body.status ?? null, ctx.userId);
    if (Object.keys(patch).length === 0) return NextResponse.json(await getChartNode(ctx.orgId, body.term));
    return NextResponse.json(await setChartNode(ctx.orgId, body.term, patch));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: msg.startsWith("concept not found") ? 404 : 400 });
  }
}

/** POST {slug}: make a page a top-level node. POST {title, slug?, related?}: the create form; no slug creates the source page. */
export async function POST(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(ctx.role, "page:edit")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  let body: { slug?: string; title?: string; related?: Array<{ slug?: string; url?: string; label?: string }> };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); }
  if (!body.slug && !body.title) return NextResponse.json({ error: "title or slug required" }, { status: 400 });
  try {
    if (body.title) return NextResponse.json(await createNode(ctx.orgId, ctx.orgSlug, { title: body.title, slug: body.slug, related: body.related }, ctx.userId));
    return NextResponse.json(await promotePageToNode(ctx.orgId, body.slug!, ctx.userId));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: /not found/.test(msg) ? 404 : 400 });
  }
}
