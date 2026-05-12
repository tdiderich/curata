import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/auth";
import { generateApiKey, hashApiKey } from "@/lib/api-key";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export async function POST(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!can(ctx.role, "key:manage")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const body = (await request.json()) as { name?: string; scopes?: string[]; expiresIn?: string };
    const name = body.name || "default";
    const VALID_SCOPES = new Set(["read", "write"]);
    const scopes = body.scopes || ["read", "write"];
    if (scopes.some((s: string) => !VALID_SCOPES.has(s))) {
      return NextResponse.json({ error: "invalid scope" }, { status: 400 });
    }

    let expiresAt: Date | null = null;
    if (body.expiresIn && body.expiresIn !== "never") {
      const now = Date.now();
      if (body.expiresIn === "1h") expiresAt = new Date(now + 60 * 60 * 1000);
      else if (body.expiresIn === "24h") expiresAt = new Date(now + 24 * 60 * 60 * 1000);
      else if (body.expiresIn === "7d") expiresAt = new Date(now + 7 * 24 * 60 * 60 * 1000);
      else if (body.expiresIn === "30d") expiresAt = new Date(now + 30 * 24 * 60 * 60 * 1000);
      else return NextResponse.json({ error: "invalid expiresIn value" }, { status: 400 });
    }

    const { key, prefix, hash } = generateApiKey();

    await db.apiKey.create({
      data: {
        orgId: ctx.orgId,
        name,
        keyHash: hash,
        prefix,
        scopes,
        createdBy: "web",
        ...(expiresAt ? { expiresAt } : {}),
      },
    });
    logAudit({
      orgId: ctx.orgId,
      action: "apikey.create",
      resourceType: "apikey",
      resourceId: prefix,
      actorType: "user",
      actorId: ctx.userId,
      metadata: { name, scopes, prefix },
    });
    return NextResponse.json({ key, prefix, expiresAt });
  } catch (err) {
    console.error("keys error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET() {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!can(ctx.role, "key:manage")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const keys = await db.apiKey.findMany({
      where: {
        orgId: ctx.orgId,
        revokedAt: null,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, prefix: true, scopes: true, createdAt: true, expiresAt: true },
    });

    return NextResponse.json(keys);
  } catch (err) {
    console.error("keys error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!can(ctx.role, "key:manage")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const body = (await request.json()) as { id: string };
    if (!body.id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const key = await db.apiKey.findFirst({
      where: { id: body.id, orgId: ctx.orgId },
    });

    if (!key) {
      return NextResponse.json({ error: "key not found" }, { status: 404 });
    }

    await db.apiKey.update({
      where: { id: body.id },
      data: { revokedAt: new Date() },
    });
    logAudit({
      orgId: ctx.orgId,
      action: "apikey.revoke",
      resourceType: "apikey",
      resourceId: key.prefix,
      actorType: "user",
      actorId: ctx.userId,
      metadata: { keyId: body.id, prefix: key.prefix, name: key.name },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("keys error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
