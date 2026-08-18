import { NextRequest, NextResponse } from "next/server";
import yaml from "js-yaml";
import { resolveOrg } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { readPage, writePageJson, markTrusted } from "@/lib/pages";
import { db } from "@/lib/db";
import { resolveEffectiveTrustMode, canApprove } from "@/lib/approval";

type Comp = Record<string, unknown>;

function findComponentDeep(
  components: Comp[],
  id: string,
): { arr: Comp[]; idx: number } | null {
  for (let i = 0; i < components.length; i++) {
    if (components[i].id === id) return { arr: components, idx: i };
    for (const nested of nestedArrays(components[i])) {
      const found = findComponentDeep(nested, id);
      if (found) return found;
    }
  }
  return null;
}

function nestedArrays(c: Comp): Comp[][] {
  const out: Comp[][] = [];
  if (Array.isArray(c.components)) out.push(c.components as Comp[]);
  if (Array.isArray(c.items)) {
    for (const item of c.items as Comp[]) {
      if (Array.isArray(item.components)) out.push(item.components as Comp[]);
    }
  }
  if (Array.isArray(c.tabs)) {
    for (const tab of c.tabs as Comp[]) {
      if (Array.isArray(tab.components)) out.push(tab.components as Comp[]);
    }
  }
  if (Array.isArray(c.columns)) {
    for (const col of c.columns as unknown[]) {
      if (Array.isArray(col)) out.push(col as Comp[]);
    }
  }
  return out;
}

export async function GET(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const slug = request.nextUrl.searchParams.get("slug");
  const componentId = request.nextUrl.searchParams.get("id");
  if (!slug || !componentId) {
    return NextResponse.json({ error: "slug and id are required" }, { status: 400 });
  }

  const page = await readPage(ctx.orgId, slug);
  if (!page) {
    return NextResponse.json({ error: "page not found" }, { status: 404 });
  }

  const components = (page.json.components ?? []) as Comp[];
  let loc = findComponentDeep(components, componentId);
  if (!loc) {
    const indexMatch = componentId.match(/^c-(\d+)$/);
    if (indexMatch) {
      const idx = parseInt(indexMatch[1], 10);
      if (idx >= 0 && idx < components.length) {
        loc = { arr: components, idx };
      }
    }
  }
  if (!loc) {
    return NextResponse.json({ error: `component "${componentId}" not found` }, { status: 404 });
  }

  const comp = { ...loc.arr[loc.idx] };
  delete comp.id;

  const componentYaml = yaml.dump(comp, {
    lineWidth: -1,
    noRefs: true,
    quotingType: '"',
    forceQuotes: false,
  }).trimEnd();

  return NextResponse.json({
    yaml: componentYaml,
    contentHash: page.contentHash,
    componentType: comp.type,
  });
}

export async function PUT(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    slug?: string;
    id?: string;
    yaml?: string;
    expectedHash?: string;
    autoTrust?: boolean;
  };

  if (!body.slug || !body.id || !body.yaml) {
    return NextResponse.json(
      { error: "slug, id, and yaml are required" },
      { status: 400 },
    );
  }

  let parsed: Comp;
  try {
    parsed = yaml.load(body.yaml) as Comp;
    if (!parsed || typeof parsed !== "object") {
      throw new Error("component must be a YAML object");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "invalid YAML";
    return NextResponse.json({ error: `YAML parse error: ${msg}` }, { status: 400 });
  }

  const pageMeta = await db.page.findUnique({
    where: { orgId_slug: { orgId: ctx.orgId, slug: body.slug } },
    select: { createdBy: true },
  });
  const isOwner = pageMeta?.createdBy === ctx.userId;
  if (!can(ctx.role, "page:edit", isOwner)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const page = await readPage(ctx.orgId, body.slug);
  if (!page) {
    return NextResponse.json({ error: "page not found" }, { status: 404 });
  }

  const components = (page.json.components ?? []) as Comp[];
  let loc = findComponentDeep(components, body.id);
  if (!loc) {
    const indexMatch = body.id.match(/^c-(\d+)$/);
    if (indexMatch) {
      const idx = parseInt(indexMatch[1], 10);
      if (idx >= 0 && idx < components.length) {
        loc = { arr: components, idx };
      }
    }
  }
  if (!loc) {
    return NextResponse.json(
      { error: `component "${body.id}" not found` },
      { status: 404 },
    );
  }

  parsed.id = loc.arr[loc.idx].id ?? body.id;
  loc.arr[loc.idx] = parsed;

  const newJson = { ...page.json, components };
  const result = await writePageJson(
    ctx.orgId,
    ctx.orgSlug,
    body.slug,
    newJson,
    "web",
    body.expectedHash ?? page.contentHash,
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }

  if (body.autoTrust) {
    const pageRow = await db.page.findUnique({
      where: { orgId_slug: { orgId: ctx.orgId, slug: body.slug } },
      select: { folderId: true, rules: true },
    });
    if (pageRow) {
      const trustMode = (await resolveEffectiveTrustMode(ctx.orgId, pageRow.folderId, pageRow.rules)).mode;
      if (trustMode === "locked") {
        const eligible = await canApprove(ctx.orgId, ctx.userId, ctx.role, body.slug);
        if (eligible) {
          const latestVersion = await db.pageVersion.findFirst({
            where: { page: { orgId: ctx.orgId, slug: body.slug } },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          });
          if (latestVersion) await markTrusted(ctx.orgId, body.slug, latestVersion.id, ctx.userId);
        }
      }
    }
  }

  return NextResponse.json({ ok: true, contentHash: result.contentHash });
}
