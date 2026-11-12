import { db } from "./db";

/**
 * The one answer for creating a page at a slug that's taken, whether the
 * caller can see that page or not. Slugs are unique per org, so the create
 * has to fail either way; the same words for both mean the failure says
 * only "taken", never "taken by a page you can't see". The suggestion is
 * the first free `<slug>-<n>`, which reveals nothing more.
 */
export async function slugInUseMessage(orgId: string, slug: string): Promise<string> {
  const taken = new Set(
    (await db.page.findMany({ where: { orgId, slug: { startsWith: `${slug}-` } }, select: { slug: true } })).map((p) => p.slug)
  );
  let n = 2;
  while (taken.has(`${slug}-${n}`)) n++;
  return `slug "${slug}" is already in use; pick another (e.g. "${slug}-${n}")`;
}
