import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";

// Quick actions are references to pages in the Skills folder, stored as a
// non-rule entry ({ id: "quick-refs", refs: [...] }) inside the Quick Actions
// folder's rules JSON. content-rules parseRules requires a string `text`
// field, so this entry is invisible to the rules system by construction.
const REFS_ID = "quick-refs";

type RulesEntry = Record<string, unknown>;

function readRefs(rules: unknown): string[] {
  if (!Array.isArray(rules)) return [];
  const entry = rules.find(
    (r): r is RulesEntry => typeof r === "object" && r !== null && (r as RulesEntry).id === REFS_ID
  );
  if (!entry || !Array.isArray(entry.refs)) return [];
  return entry.refs.filter((s: unknown): s is string => typeof s === "string");
}

function writeRefs(rules: unknown, refs: string[]): RulesEntry[] {
  const rest = Array.isArray(rules)
    ? rules.filter((r) => !(typeof r === "object" && r !== null && (r as RulesEntry).id === REFS_ID))
    : [];
  return [...rest, { id: REFS_ID, refs }];
}

async function getQaFolder(orgId: string) {
  return db.folder.findFirst({
    where: { orgId, name: "Quick Actions", locked: true },
    select: { id: true, rules: true },
  });
}

export async function GET() {
  const ctx = await resolveOrg();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const qa = await getQaFolder(ctx.orgId);
  return NextResponse.json({ refs: qa ? readRefs(qa.rules) : [] });
}

export async function POST(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(ctx.role, "page:edit")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const body = (await request.json()) as { slug?: string };
    if (!body.slug) {
      return NextResponse.json({ error: "slug is required" }, { status: 400 });
    }

    // A quick action must reference an existing page in the Skills folder.
    const page = await db.page.findUnique({
      where: { orgId_slug: { orgId: ctx.orgId, slug: body.slug } },
      select: { folderId: true, status: true },
    });
    if (!page || page.status === "archived") {
      return NextResponse.json({ error: "page not found" }, { status: 404 });
    }
    const skillsFolder = await db.folder.findFirst({
      where: { orgId: ctx.orgId, name: "Skills" },
      select: { id: true },
    });
    if (!skillsFolder || page.folderId !== skillsFolder.id) {
      return NextResponse.json(
        { error: "quick actions can only reference pages in the Skills folder" },
        { status: 400 }
      );
    }

    const qa = await getQaFolder(ctx.orgId);
    if (!qa) {
      return NextResponse.json({ error: "Quick Actions folder not found" }, { status: 404 });
    }

    const refs = readRefs(qa.rules);
    if (!refs.includes(body.slug)) refs.push(body.slug);
    await db.folder.update({
      where: { id: qa.id },
      data: { rules: writeRefs(qa.rules, refs) as unknown as Prisma.InputJsonValue },
    });

    return NextResponse.json({ refs });
  } catch (err) {
    console.error("quick-actions error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(ctx.role, "page:edit")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const body = (await request.json()) as { slug?: string };
    if (!body.slug) {
      return NextResponse.json({ error: "slug is required" }, { status: 400 });
    }

    const qa = await getQaFolder(ctx.orgId);
    if (!qa) {
      return NextResponse.json({ error: "Quick Actions folder not found" }, { status: 404 });
    }

    const refs = readRefs(qa.rules).filter((s) => s !== body.slug);
    await db.folder.update({
      where: { id: qa.id },
      data: { rules: writeRefs(qa.rules, refs) as unknown as Prisma.InputJsonValue },
    });

    return NextResponse.json({ refs });
  } catch (err) {
    console.error("quick-actions error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
