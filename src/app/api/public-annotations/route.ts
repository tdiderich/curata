import { NextRequest, NextResponse } from "next/server";
import { resolveCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { saveAnnotation } from "@/lib/pages";

export async function POST(request: NextRequest) {
  const user = await resolveCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "sign in to annotate" }, { status: 401 });
  }

  const authorName = user.name || user.email || "Anonymous";

  try {
    const body = await request.json();
    const { orgSlug, pageSlug, text, section, target } = body;

    if (!orgSlug || !pageSlug || !text) {
      return NextResponse.json(
        { error: "orgSlug, pageSlug, and text are required" },
        { status: 400 },
      );
    }

    if (text.length > 4000 || (section && section.length > 500) || (target && target.length > 2000)) {
      return NextResponse.json({ error: "input too long" }, { status: 400 });
    }

    const org = await db.organization.findUnique({
      where: { slug: orgSlug },
      select: { id: true, slug: true },
    });
    if (!org) {
      return NextResponse.json({ error: "org not found" }, { status: 404 });
    }

    const page = await db.page.findUnique({
      where: { orgId_slug: { orgId: org.id, slug: pageSlug } },
      select: { id: true, visibility: true },
    });
    if (!page || page.visibility !== "public") {
      return NextResponse.json({ error: "page not found" }, { status: 404 });
    }

    const ann = await saveAnnotation(
      org.id,
      org.slug,
      pageSlug,
      text,
      authorName,
      section || undefined,
      target || undefined,
      undefined,
      undefined,
      "web",
    );

    return NextResponse.json(ann, { status: 201 });
  } catch (err) {
    console.error("public-annotations error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
