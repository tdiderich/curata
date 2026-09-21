import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { addScopeItem, getScopeSuggestions, removeScopeItem, updateScopeItem } from "@/lib/scope";

function fail(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ error: msg }, { status: /not found/.test(msg) ? 404 : 400 });
}

/** GET ?term= suggestions. POST add {term, slug|url, label?, owner?, dueAt?, check?}. PATCH {url, term?, owner?, label?, dueAt?, check?}. DELETE {term, slug|url}. */
export async function GET(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const term = request.nextUrl.searchParams.get("term");
  if (!term) return NextResponse.json({ error: "term required" }, { status: 400 });
  try { return NextResponse.json(await getScopeSuggestions(ctx.orgId, term)); } catch (err) { return fail(err); }
}

async function gate(): Promise<{ res: NextResponse; ctx?: undefined } | { res?: undefined; ctx: { orgId: string; userId: string } }> {
  const ctx = await resolveOrg();
  if (!ctx) return { res: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  if (!can(ctx.role, "page:edit")) return { res: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  return { ctx: { orgId: ctx.orgId, userId: ctx.userId } };
}

export async function POST(request: NextRequest) {
  const g = await gate(); if (g.res) return g.res;
  let body: { term?: string; slug?: string; url?: string; label?: string; owner?: string; dueAt?: string | null; check?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); }
  if (!body.term) return NextResponse.json({ error: "term required" }, { status: 400 });
  try { return NextResponse.json(await addScopeItem(g.ctx.orgId, body.term, body, g.ctx.userId)); } catch (err) { return fail(err); }
}

export async function PATCH(request: NextRequest) {
  const g = await gate(); if (g.res) return g.res;
  let body: { url?: string; term?: string; owner?: string | null; label?: string; dueAt?: string | null; check?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); }
  if (!body.url) return NextResponse.json({ error: "url required" }, { status: 400 });
  try { return NextResponse.json(await updateScopeItem(g.ctx.orgId, { ...body, url: body.url })); } catch (err) { return fail(err); }
}

export async function DELETE(request: NextRequest) {
  const g = await gate(); if (g.res) return g.res;
  let body: { term?: string; slug?: string; url?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); }
  if (!body.term) return NextResponse.json({ error: "term required" }, { status: 400 });
  try { return NextResponse.json(await removeScopeItem(g.ctx.orgId, body.term, body, g.ctx.userId)); } catch (err) { return fail(err); }
}
