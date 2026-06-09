import { NextResponse } from "next/server";
import { resolveOrg } from "@/lib/auth";
import { db } from "@/lib/db";

// Serves the org's uploaded logo bytes. Locked-down CSP because the content
// is user-uploaded (SVG can carry scripts when navigated to directly; inside
// an <img> it's inert either way).
export async function GET() {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const org = await db.organization.findUnique({
    where: { id: ctx.orgId },
    select: { logoData: true, logoMime: true },
  });

  if (!org?.logoData || !org.logoMime) {
    return NextResponse.json({ error: "no logo" }, { status: 404 });
  }

  return new NextResponse(Buffer.from(org.logoData), {
    headers: {
      "Content-Type": org.logoMime,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}
