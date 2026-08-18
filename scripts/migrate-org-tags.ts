/**
 * One-off: migrate each org's org.rules "org-tags" reserved entry (the old
 * home for recommended organization tags) into Concept rows - orgId set to
 * the org, isRecommended: true. Strips the reserved entry out of org.rules
 * afterward since org-tags is no longer read from there (see lib/org-tags.ts).
 * Other rule types in org.rules are left untouched.
 *
 * Run: npx tsx scripts/migrate-org-tags.ts
 */
import { db } from "../src/lib/db";
import { withOrgTags } from "../src/lib/org-tags";
import type { Prisma } from "../src/generated/prisma/client";

const ORG_TAGS_RULE_ID = "org-tags";

function isOrgTagsEntry(r: unknown): r is { id: string; tags?: unknown } {
  return typeof r === "object" && r !== null && (r as Record<string, unknown>).id === ORG_TAGS_RULE_ID;
}

async function main() {
  const orgs = await db.organization.findMany({ select: { id: true, slug: true, rules: true } });
  let migrated = 0;

  for (const org of orgs) {
    if (!Array.isArray(org.rules)) continue;
    const entry = org.rules.find(isOrgTagsEntry);
    if (!entry) continue;

    const tags = Array.isArray(entry.tags)
      ? entry.tags.filter((t): t is string => typeof t === "string" && !!t)
      : [];

    if (tags.length > 0) {
      await withOrgTags(org.id, tags);
    }

    const rest = org.rules.filter((r) => !isOrgTagsEntry(r));
    await db.organization.update({
      where: { id: org.id },
      data: { rules: rest as Prisma.InputJsonValue },
    });

    migrated++;
    console.log(`${org.slug}: migrated ${tags.length} org tag(s) to Concept rows`);
  }

  console.log(`done: ${migrated} org(s) touched`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
