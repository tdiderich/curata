import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/auth";
import { previewTemplate } from "@/lib/projects";

/**
 * What create_project would clone from one or more maps, before you commit
 * to picking them. Backs the New project form's live preview.
 */
export async function GET(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const terms = request.nextUrl.searchParams.getAll("term");
  if (terms.length === 0) return NextResponse.json({ error: "term is required" }, { status: 400 });
  try {
    const previews = await Promise.all(terms.map((t) => previewTemplate(ctx.orgId, t)));
    return NextResponse.json(previews);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
