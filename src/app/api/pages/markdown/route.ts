import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/auth";
import { readPage } from "@/lib/pages";
import { pageToMarkdown } from "@/lib/page-markdown";
import { getPageOrThrow, PageAccessError } from "@/lib/access";

// Authenticated counterpart to /p/[orgSlug]/[pageSlug]/md — that route is for
// public pages only. This one backs the "copy for agent" actions across the
// dashboard (tag/folder bundles, single-page copy) for any page the caller
// can already see, public or not.
export async function GET(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const slug = request.nextUrl.searchParams.get("slug");
  if (!slug) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  try {
    await getPageOrThrow(ctx.orgId, slug, ctx.userId, ctx.role);
  } catch (e) {
    if (e instanceof PageAccessError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const data = await readPage(ctx.orgId, slug);
  if (!data) {
    return NextResponse.json({ error: "page not found" }, { status: 404 });
  }

  const title = typeof data.json.title === "string" ? data.json.title : slug;
  return NextResponse.json({ title, markdown: pageToMarkdown(data.json) });
}
