import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { markTrusted, clearTrusted } from "@/lib/pages";
import { canApprove, getApprovers, describeApprovalRule, resolveEffectiveTrustMode } from "@/lib/approval";
import { db } from "@/lib/db";

/// markTrusted/clearTrusted stay dumb pointer-movers (see pages.ts) —
/// approval-eligibility enforcement lives here at the route layer, matching
/// how page:edit is already checked here rather than inside the lib fns.
async function approvalDenialMessage(orgId: string, slug: string): Promise<string> {
  const resolved = await getApprovers(orgId, slug);
  if (!resolved) return "forbidden";
  const note = await describeApprovalRule(orgId, resolved.rule);
  return `forbidden: ${note}`;
}

export async function POST(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!can(ctx.role, "page:edit")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { slug, versionId } = body as { slug?: string; versionId?: string };

    if (!slug || !versionId) {
      return NextResponse.json(
        { error: "slug and versionId are required" },
        { status: 400 }
      );
    }

    const pageRow = await db.page.findUnique({
      where: { orgId_slug: { orgId: ctx.orgId, slug } },
      select: { folderId: true, rules: true },
    });
    if (pageRow) {
      const { mode } = await resolveEffectiveTrustMode(ctx.orgId, pageRow.folderId, pageRow.rules);
      if (mode === "auto") {
        return NextResponse.json({ ok: true, noop: true });
      }
    }

    const eligible = await canApprove(ctx.orgId, ctx.userId, ctx.role, slug);
    if (!eligible) {
      return NextResponse.json({ error: await approvalDenialMessage(ctx.orgId, slug) }, { status: 403 });
    }

    const result = await markTrusted(ctx.orgId, slug, versionId, ctx.userId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("mark trusted error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!can(ctx.role, "page:edit")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { slug } = body as { slug?: string };

    if (!slug) {
      return NextResponse.json({ error: "slug is required" }, { status: 400 });
    }

    const eligible = await canApprove(ctx.orgId, ctx.userId, ctx.role, slug);
    if (!eligible) {
      return NextResponse.json({ error: await approvalDenialMessage(ctx.orgId, slug) }, { status: 403 });
    }

    const result = await clearTrusted(ctx.orgId, slug, ctx.userId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("clear trusted error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
