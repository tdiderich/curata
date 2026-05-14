import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { isPersonalEmailDomain } from "@/lib/personal-domains";

const VALID_THEMES = [
  "dark",
  "light",
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "indigo",
  "violet",
];
const VALID_MODES = ["dark", "light"];
const VALID_TEXTURES = ["none", "dots", "grid", "grain", "topography", "diagonal"];
const VALID_GLOWS = ["none", "accent", "corner"];

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$|^[a-z0-9]{3,40}$/;

export async function GET() {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const org = await db.organization.findUnique({
    where: { id: ctx.orgId },
    select: { name: true, slug: true, domain: true, theme: true, mode: true, texture: true, glow: true },
  });

  return NextResponse.json(org);
}

export async function PATCH(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!can(ctx.role, "member:manage")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const data: Record<string, string | null> = {};

    if (body.name !== undefined) {
      const trimmed = (body.name as string).trim();
      if (!trimmed || trimmed.length > 100) {
        return NextResponse.json({ error: "name must be 1-100 characters" }, { status: 400 });
      }
      data.name = trimmed;
    }
    if (body.slug !== undefined) {
      const s = (body.slug as string).trim().toLowerCase();
      if (!s) {
        return NextResponse.json({ error: "slug cannot be empty" }, { status: 400 });
      }
      if (!SLUG_PATTERN.test(s)) {
        return NextResponse.json(
          { error: "slug must be 3-40 chars, lowercase letters, numbers, and hyphens only" },
          { status: 400 }
        );
      }
      // Check for conflicts with other orgs
      const conflict = await db.organization.findFirst({
        where: { slug: s, NOT: { id: ctx.orgId } },
        select: { id: true },
      });
      if (conflict) {
        return NextResponse.json({ error: "that slug is already taken" }, { status: 409 });
      }
      data.slug = s;
    }
    if (body.domain !== undefined) {
      const d = (body.domain as string).trim().toLowerCase();
      if (d && (!d.includes(".") || d.includes(" "))) {
        return NextResponse.json({ error: "invalid domain format" }, { status: 400 });
      }
      if (d && isPersonalEmailDomain(d)) {
        return NextResponse.json({ error: "personal email domains (gmail, outlook, etc.) cannot be used for auto-join" }, { status: 400 });
      }
      data.domain = d || null;
    }
    if (body.theme !== undefined) {
      const theme = body.theme as string;
      if (!VALID_THEMES.includes(theme)) {
        return NextResponse.json({ error: "invalid theme" }, { status: 400 });
      }
      data.theme = theme;
    }
    if (body.mode !== undefined) {
      const mode = body.mode as string;
      if (!VALID_MODES.includes(mode)) {
        return NextResponse.json({ error: "invalid mode" }, { status: 400 });
      }
      data.mode = mode;
    }
    if (body.texture !== undefined) {
      const texture = body.texture as string;
      if (!VALID_TEXTURES.includes(texture)) {
        return NextResponse.json({ error: "invalid texture" }, { status: 400 });
      }
      data.texture = texture;
    }
    if (body.glow !== undefined) {
      const glow = body.glow as string;
      if (!VALID_GLOWS.includes(glow)) {
        return NextResponse.json({ error: "invalid glow" }, { status: 400 });
      }
      data.glow = glow;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "no valid fields" }, { status: 400 });
    }

    const updated = await db.organization.update({
      where: { id: ctx.orgId },
      data,
      select: { name: true, slug: true, domain: true, theme: true, mode: true, texture: true, glow: true },
    });

    return NextResponse.json(updated);
  } catch (err) {
    console.error("org-settings error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
