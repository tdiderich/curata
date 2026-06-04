import Link from "next/link";
import { resolveOrg } from "@/lib/auth";
import { db } from "@/lib/db";

export default async function ConceptsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let siteName = "curata";

  try {
    const ctx = await resolveOrg();
    if (ctx) {
      const org = await db.organization.findUnique({
        where: { id: ctx.orgId },
        select: { name: true },
      });
      if (org) siteName = org.name;
    }
  } catch {
    // build-time fallback
  }

  return (
    <>
      <div className="site-bar">
        <Link className="site-bar-name" href="/">
          {siteName}
        </Link>
        <div className="site-bar-right">
          <Link href="/dashboard" className="nav-link">
            Pages
          </Link>
        </div>
      </div>
      <main className="container main-content">{children}</main>
    </>
  );
}
