import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/auth";
import { verifyDependent } from "@/lib/concepts";
import { logAudit } from "@/lib/audit";

/**
 * "Looked at it, still right." Backs the Verify button on the Dependencies
 * settings tab. Same lib call as the mark_verified MCP tool, so a human
 * clicking and an agent calling leave identical state.
 */
export async function POST(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { slug?: string; url?: string; term?: string; note?: string; status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.slug && !body.url) {
    return NextResponse.json({ error: "slug or url required" }, { status: 400 });
  }

  try {
    const result = await verifyDependent(ctx.orgId, {
      slug: body.slug || undefined,
      url: body.url || undefined,
      term: body.term || undefined,
      note: typeof body.note === "string" ? body.note.slice(0, 500) : undefined,
      status: body.status === "needs_change" ? "needs_change" : body.status === "unreachable" ? "unreachable" : "holds",
    });
    logAudit({
      orgId: ctx.orgId,
      action: "page.verify",
      resourceType: result.kind,
      resourceId: result.id,
      actorId: ctx.userId,
      metadata: { note: result.note, term: result.term, status: result.status },
    }).catch(() => {});
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: /not found|no external asset tracked/.test(message) ? 404 : 400 });
  }
}
