import { NextResponse } from "next/server";
import { resolveOrg } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { DEFAULT_CONTENT_RULES } from "@/lib/content-rules";
import type { ContentRule } from "@/lib/content-rules";
import { Prisma } from "@/generated/prisma/client";

export async function POST() {
  const ctx = await resolveOrg();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(ctx.role, "rules:manage")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const org = await db.organization.findUnique({
    where: { id: ctx.orgId },
    select: { rules: true },
  });

  const existing: ContentRule[] = (() => {
    const raw = org?.rules;
    if (!raw || !Array.isArray(raw)) return [];
    return (raw as unknown as Record<string, unknown>[]).filter(
      (r) => typeof r === "object" && r !== null &&
        typeof r.id === "string" && typeof r.text === "string"
    ).map((r) => ({
      id: r.id as string,
      text: r.text as string,
      mode: (r.mode === "block" ? "block" : "warn") as "block" | "warn",
      ...(Array.isArray(r.patterns) ? { patterns: r.patterns as string[] } : {}),
    }));
  })();

  const merged = [...existing];
  const existingIds = new Set(merged.map((r) => r.id));

  for (const def of DEFAULT_CONTENT_RULES) {
    if (existingIds.has(def.id)) {
      const idx = merged.findIndex((r) => r.id === def.id);
      merged[idx] = def;
    } else {
      merged.push(def);
    }
  }

  await db.organization.update({
    where: { id: ctx.orgId },
    data: { rules: merged as unknown as Prisma.InputJsonValue },
  });

  return NextResponse.json({ ok: true, rules: merged });
}
