import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { resolveOrg } from "@/lib/auth";
import { searchPages } from "@/lib/pages";

export async function GET(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const query = request.nextUrl.searchParams.get("query") ?? "";

  if (!query.trim() || query.length > 200) {
    return NextResponse.json([]);
  }

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  const origin = host ? `${proto}://${host}` : undefined;

  try {
    const results = await searchPages(ctx.orgId, query, ctx.userId, { origin });
    return NextResponse.json(results);
  } catch (err) {
    console.error("search error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
