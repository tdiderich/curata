import { NextRequest, NextResponse } from "next/server";
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

  try {
    const results = await searchPages(ctx.orgId, query, ctx.userId);
    return NextResponse.json(results);
  } catch (err) {
    console.error("search error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
