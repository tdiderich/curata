import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { readPage, writePageJson, markTrusted } from "@/lib/pages";
import { db } from "@/lib/db";
import { resolveEffectiveTrustMode, canApprove } from "@/lib/approval";

type Comp = Record<string, unknown>;

export async function POST(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { slug, componentId, targetId, position, op, component, components: replaceAll, autoTrust } = body as {
    slug: string;
    componentId?: string;
    targetId?: string;
    position?: "before" | "after";
    op?: "remove" | "append" | "replace-all";
    component?: Comp;
    components?: Comp[];
    autoTrust?: boolean;
  };

  if (!slug) {
    return NextResponse.json(
      { error: "slug is required" },
      { status: 400 },
    );
  }

  if (op === "replace-all" && (!Array.isArray(replaceAll))) {
    return NextResponse.json(
      { error: "components array is required for replace-all" },
      { status: 400 },
    );
  }

  if (op === "append" && (!component || typeof component !== "object")) {
    return NextResponse.json(
      { error: "component object is required for append" },
      { status: 400 },
    );
  }

  if (op !== "append" && op !== "replace-all" && !componentId) {
    return NextResponse.json(
      { error: "componentId is required" },
      { status: 400 },
    );
  }

  if (op !== "remove" && op !== "append" && op !== "replace-all" && (!targetId || !position)) {
    return NextResponse.json(
      { error: "targetId and position are required for reorder" },
      { status: 400 },
    );
  }

  const pageMeta = await db.page.findUnique({
    where: { orgId_slug: { orgId: ctx.orgId, slug } },
    select: { createdBy: true },
  });

  const isOwner = pageMeta?.createdBy === ctx.userId;
  if (!can(ctx.role, "page:edit", isOwner)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const page = await readPage(ctx.orgId, slug);
  if (!page) {
    return NextResponse.json({ error: "page not found" }, { status: 404 });
  }

  const components = [...((page.json.components ?? []) as Comp[])];

  async function maybeAutoTrust() {
    if (!autoTrust) return;
    const pageRow = await db.page.findUnique({
      where: { orgId_slug: { orgId: ctx!.orgId, slug } },
      select: { folderId: true, rules: true },
    });
    if (!pageRow) return;
    const trustMode = (await resolveEffectiveTrustMode(ctx!.orgId, pageRow.folderId, pageRow.rules)).mode;
    if (trustMode !== "locked") return;
    const eligible = await canApprove(ctx!.orgId, ctx!.userId, ctx!.role, slug);
    if (!eligible) return;
    const latestVersion = await db.pageVersion.findFirst({
      where: { page: { orgId: ctx!.orgId, slug } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (latestVersion) await markTrusted(ctx!.orgId, slug, latestVersion.id, ctx!.userId);
  }

  if (op === "replace-all") {
    const newJson = { ...page.json, components: replaceAll };
    const result = await writePageJson(ctx.orgId, ctx.orgSlug, slug, newJson, "web", page.contentHash);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 409 });
    }
    await maybeAutoTrust();
    return NextResponse.json({ ok: true });
  }

  if (op === "append") {
    components.push(component!);
    const newJson = { ...page.json, components };
    const result = await writePageJson(ctx.orgId, ctx.orgSlug, slug, newJson, "web", page.contentHash);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 409 });
    }
    await maybeAutoTrust();
    return NextResponse.json({ ok: true });
  }

  const srcIdx = components.findIndex((c) => c.id === componentId);
  if (srcIdx === -1) {
    return NextResponse.json(
      { error: `component "${componentId}" not found` },
      { status: 404 },
    );
  }

  const moved = components.splice(srcIdx, 1)[0];

  if (op === "remove") {
    const newJson = { ...page.json, components };
    const result = await writePageJson(ctx.orgId, ctx.orgSlug, slug, newJson, "web", page.contentHash);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 409 });
    }
    await maybeAutoTrust();
    return NextResponse.json({ ok: true });
  }

  const destIdx = components.findIndex((c) => c.id === targetId);
  if (destIdx === -1) {
    return NextResponse.json(
      { error: `target "${targetId}" not found` },
      { status: 404 },
    );
  }

  const insertAt = position === "before" ? destIdx : destIdx + 1;
  components.splice(insertAt, 0, moved);

  const newJson = { ...page.json, components };
  const result = await writePageJson(ctx.orgId, ctx.orgSlug, slug, newJson, "web", page.contentHash);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }
  await maybeAutoTrust();

  return NextResponse.json({ ok: true });
}
