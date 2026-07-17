import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { resolveOrg } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import type { ContentRule } from "@/lib/content-rules";
import { Prisma } from "@/generated/prisma/client";

function parseRulesJson(raw: unknown): ContentRule[] {
  if (!raw || !Array.isArray(raw)) return [];
  return raw.filter(
    (r): r is ContentRule =>
      typeof r === "object" && r !== null &&
      typeof r.id === "string" && typeof r.text === "string"
  );
}

function validateRule(rule: unknown): { ok: true; rule: ContentRule } | { ok: false; error: string } {
  if (!rule || typeof rule !== "object") return { ok: false, error: "rule must be an object" };
  const r = rule as Record<string, unknown>;
  if (!r.text || typeof r.text !== "string" || r.text.trim().length === 0) {
    return { ok: false, error: "rule text is required" };
  }
  if (r.mode && r.mode !== "block" && r.mode !== "warn") {
    return { ok: false, error: "mode must be 'block' or 'warn'" };
  }
  if (r.patterns !== undefined) {
    if (!Array.isArray(r.patterns)) return { ok: false, error: "patterns must be an array" };
    for (const p of r.patterns) {
      if (typeof p !== "string") return { ok: false, error: "each pattern must be a string" };
      try { new RegExp(p, "i"); } catch { return { ok: false, error: `invalid regex pattern: ${p}` }; }
    }
  }
  const id = (r.id as string) || crypto.randomUUID().slice(0, 8);
  return {
    ok: true,
    rule: {
      id,
      text: r.text.trim(),
      mode: (r.mode as "block" | "warn") || "warn",
      ...(r.patterns ? { patterns: r.patterns as string[] } : {}),
    },
  };
}

type ScopeResult =
  | { type: "global" }
  | { type: "folder"; id: string }
  | { type: "page"; slug: string };

function parseScope(params: URLSearchParams): ScopeResult | null {
  const scope = params.get("scope") || "global";
  if (scope === "global") return { type: "global" };
  if (scope.startsWith("folder:")) {
    const id = scope.slice(7);
    return id ? { type: "folder", id } : null;
  }
  if (scope === "folder") {
    const id = params.get("id");
    if (!id) return null;
    return { type: "folder", id };
  }
  if (scope.startsWith("page:")) {
    const slug = scope.slice(5);
    return slug ? { type: "page", slug } : null;
  }
  if (scope === "page") {
    const slug = params.get("slug");
    if (!slug) return null;
    return { type: "page", slug };
  }
  return null;
}

export async function GET(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const scope = parseScope(request.nextUrl.searchParams);
  if (!scope) return NextResponse.json({ error: "invalid scope" }, { status: 400 });

  if (scope.type === "global") {
    if (!can(ctx.role, "rules:manage")) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const org = await db.organization.findUnique({
      where: { id: ctx.orgId },
      select: { rules: true },
    });
    return NextResponse.json({ scope: "global", rules: parseRulesJson(org?.rules) });
  }

  if (scope.type === "folder") {
    if (!can(ctx.role, "folder:manage")) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const folder = await db.folder.findFirst({
      where: { id: scope.id, orgId: ctx.orgId },
      select: { rules: true },
    });
    if (!folder) return NextResponse.json({ error: "folder not found" }, { status: 404 });
    return NextResponse.json({ scope: `folder:${scope.id}`, rules: parseRulesJson(folder.rules) });
  }

  if (!can(ctx.role, "page:edit")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const page = await db.page.findFirst({
    where: { slug: scope.slug, orgId: ctx.orgId },
    select: { rules: true },
  });
  if (!page) return NextResponse.json({ error: "page not found" }, { status: 404 });
  return NextResponse.json({ scope: `page:${scope.slug}`, rules: parseRulesJson(page.rules) });
}

export async function POST(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const scope = parseScope(request.nextUrl.searchParams);
  if (!scope) return NextResponse.json({ error: "invalid scope" }, { status: 400 });

  const body = await request.json();
  const result = validateRule(body);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  if (scope.type === "global") {
    if (!can(ctx.role, "rules:manage")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const org = await db.organization.findUnique({ where: { id: ctx.orgId }, select: { rules: true } });
    const existing = parseRulesJson(org?.rules);
    if (existing.some((r) => r.id === result.rule.id)) {
      return NextResponse.json({ error: "rule ID already exists" }, { status: 409 });
    }
    existing.push(result.rule);
    await db.organization.update({
      where: { id: ctx.orgId },
      data: { rules: existing as unknown as Prisma.InputJsonValue },
    });
    revalidatePath("/settings");
    return NextResponse.json({ ok: true, rule: result.rule });
  }

  if (scope.type === "folder") {
    if (!can(ctx.role, "folder:manage")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const folder = await db.folder.findFirst({ where: { id: scope.id, orgId: ctx.orgId }, select: { rules: true } });
    if (!folder) return NextResponse.json({ error: "folder not found" }, { status: 404 });
    const existing = parseRulesJson(folder.rules);
    if (existing.some((r) => r.id === result.rule.id)) {
      return NextResponse.json({ error: "rule ID already exists" }, { status: 409 });
    }
    existing.push(result.rule);
    await db.folder.update({
      where: { id: scope.id },
      data: { rules: existing as unknown as Prisma.InputJsonValue },
    });
    return NextResponse.json({ ok: true, rule: result.rule });
  }

  if (!can(ctx.role, "page:edit")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const page = await db.page.findFirst({ where: { slug: scope.slug, orgId: ctx.orgId }, select: { id: true, rules: true } });
  if (!page) return NextResponse.json({ error: "page not found" }, { status: 404 });
  const existing = parseRulesJson(page.rules);
  if (existing.some((r) => r.id === result.rule.id)) {
    return NextResponse.json({ error: "rule ID already exists" }, { status: 409 });
  }
  existing.push(result.rule);
  await db.page.update({
    where: { id: page.id },
    data: { rules: existing as unknown as Prisma.InputJsonValue },
  });
  return NextResponse.json({ ok: true, rule: result.rule });
}

export async function PUT(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const scope = parseScope(request.nextUrl.searchParams);
  if (!scope) return NextResponse.json({ error: "invalid scope" }, { status: 400 });

  const body = await request.json();
  const ruleId = body.id;
  if (!ruleId || typeof ruleId !== "string") {
    return NextResponse.json({ error: "rule id is required" }, { status: 400 });
  }
  const result = validateRule(body);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  if (scope.type === "global") {
    if (!can(ctx.role, "rules:manage")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const org = await db.organization.findUnique({ where: { id: ctx.orgId }, select: { rules: true } });
    const existing = parseRulesJson(org?.rules);
    const idx = existing.findIndex((r) => r.id === ruleId);
    if (idx === -1) return NextResponse.json({ error: "rule not found" }, { status: 404 });
    existing[idx] = result.rule;
    await db.organization.update({
      where: { id: ctx.orgId },
      data: { rules: existing as unknown as Prisma.InputJsonValue },
    });
    revalidatePath("/settings");
    return NextResponse.json({ ok: true, rule: result.rule });
  }

  if (scope.type === "folder") {
    if (!can(ctx.role, "folder:manage")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const folder = await db.folder.findFirst({ where: { id: scope.id, orgId: ctx.orgId }, select: { rules: true } });
    if (!folder) return NextResponse.json({ error: "folder not found" }, { status: 404 });
    const existing = parseRulesJson(folder.rules);
    const idx = existing.findIndex((r) => r.id === ruleId);
    if (idx === -1) return NextResponse.json({ error: "rule not found" }, { status: 404 });
    existing[idx] = result.rule;
    await db.folder.update({
      where: { id: scope.id },
      data: { rules: existing as unknown as Prisma.InputJsonValue },
    });
    return NextResponse.json({ ok: true, rule: result.rule });
  }

  if (!can(ctx.role, "page:edit")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const page = await db.page.findFirst({ where: { slug: scope.slug, orgId: ctx.orgId }, select: { id: true, rules: true } });
  if (!page) return NextResponse.json({ error: "page not found" }, { status: 404 });
  const existing = parseRulesJson(page.rules);
  const idx = existing.findIndex((r) => r.id === ruleId);
  if (idx === -1) return NextResponse.json({ error: "rule not found" }, { status: 404 });
  existing[idx] = result.rule;
  await db.page.update({
    where: { id: page.id },
    data: { rules: existing as unknown as Prisma.InputJsonValue },
  });
  return NextResponse.json({ ok: true, rule: result.rule });
}

export async function DELETE(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const scope = parseScope(request.nextUrl.searchParams);
  if (!scope) return NextResponse.json({ error: "invalid scope" }, { status: 400 });

  const ruleId = request.nextUrl.searchParams.get("ruleId");
  if (!ruleId) return NextResponse.json({ error: "ruleId param required" }, { status: 400 });

  if (scope.type === "global") {
    if (!can(ctx.role, "rules:manage")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const org = await db.organization.findUnique({ where: { id: ctx.orgId }, select: { rules: true } });
    const existing = parseRulesJson(org?.rules);
    const filtered = existing.filter((r) => r.id !== ruleId);
    if (filtered.length === existing.length) return NextResponse.json({ error: "rule not found" }, { status: 404 });
    await db.organization.update({
      where: { id: ctx.orgId },
      data: { rules: filtered.length > 0 ? (filtered as unknown as Prisma.InputJsonValue) : Prisma.DbNull },
    });
    revalidatePath("/settings");
    return NextResponse.json({ ok: true });
  }

  if (scope.type === "folder") {
    if (!can(ctx.role, "folder:manage")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const folder = await db.folder.findFirst({ where: { id: scope.id, orgId: ctx.orgId }, select: { rules: true } });
    if (!folder) return NextResponse.json({ error: "folder not found" }, { status: 404 });
    const existing = parseRulesJson(folder.rules);
    const filtered = existing.filter((r) => r.id !== ruleId);
    if (filtered.length === existing.length) return NextResponse.json({ error: "rule not found" }, { status: 404 });
    await db.folder.update({
      where: { id: scope.id },
      data: { rules: filtered.length > 0 ? (filtered as unknown as Prisma.InputJsonValue) : Prisma.DbNull },
    });
    return NextResponse.json({ ok: true });
  }

  if (!can(ctx.role, "page:edit")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const page = await db.page.findFirst({ where: { slug: scope.slug, orgId: ctx.orgId }, select: { id: true, rules: true } });
  if (!page) return NextResponse.json({ error: "page not found" }, { status: 404 });
  const existing = parseRulesJson(page.rules);
  const filtered = existing.filter((r) => r.id !== ruleId);
  if (filtered.length === existing.length) return NextResponse.json({ error: "rule not found" }, { status: 404 });
  await db.page.update({
    where: { id: page.id },
    data: { rules: filtered.length > 0 ? (filtered as unknown as Prisma.InputJsonValue) : Prisma.DbNull },
  });
  return NextResponse.json({ ok: true });
}
