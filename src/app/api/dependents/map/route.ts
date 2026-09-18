import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { mapDependencies, normalizeTerm } from "@/lib/concepts";
import { logAudit } from "@/lib/audit";

/**
 * Backs the New map screen. Same lib call as the map_dependencies MCP tool,
 * so a human building a graph by hand and an agent building one from a
 * prompt leave identical edges.
 */
export async function POST(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(ctx.role, "page:edit")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body: {
    term?: string;
    kind?: string;
    asserts?: string[];
    depends?: string[];
    external?: Array<{ url?: string; label?: string; owner?: string }>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const term = typeof body.term === "string" ? normalizeTerm(body.term) : "";
  if (!term) return NextResponse.json({ error: "term is required" }, { status: 400 });
  const slugs = (xs: unknown) => (Array.isArray(xs) ? xs.filter((x): x is string => typeof x === "string" && x.trim() !== "") : []);
  const external = (Array.isArray(body.external) ? body.external : [])
    .filter((e) => e && typeof e.url === "string" && e.url.trim() !== "")
    .map((e) => ({ url: (e.url as string).trim(), label: e.label?.trim() || undefined, owner: e.owner?.trim() || undefined }));

  try {
    const result = await mapDependencies(ctx.orgId, {
      term,
      kind: typeof body.kind === "string" && body.kind.trim() ? normalizeTerm(body.kind) : undefined,
      asserts: slugs(body.asserts),
      depends: slugs(body.depends),
      external,
    }, ctx.userId);
    logAudit({
      orgId: ctx.orgId,
      action: "dependencies.map",
      resourceType: "concept",
      resourceId: result.term,
      actorId: ctx.userId,
      metadata: { tagged: result.tagged.length, external: result.external.length, missing: result.missing },
    }).catch(() => {});
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
