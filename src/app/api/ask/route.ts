import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/auth";
import { getRelated, getVocabulary } from "@/lib/concepts";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const action = searchParams.get("action");

  if (action === "vocabulary") {
    const kind = searchParams.get("kind") ?? undefined;
    const q = searchParams.get("q") ?? undefined;
    const result = await getVocabulary(kind, q);
    return NextResponse.json(result);
  }

  const term = searchParams.get("term");
  if (!term) return NextResponse.json({ error: "term required" }, { status: 400 });

  const result = await getRelated(ctx.orgId, { term });
  return NextResponse.json(result);
}
