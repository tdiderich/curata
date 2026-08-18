/**
 * Backfill Page.pageType from each page's latest version YAML content.
 * Pages that already have a pageType value are skipped.
 *
 * Run: npx tsx scripts/backfill-page-type.ts
 */
import { db } from "../src/lib/db";
import { extractDeclaredPageType } from "../src/lib/required-components";

const BATCH = 50;

async function main() {
  let filled = 0;
  let skip = 0;
  let offset = 0;

  for (;;) {
    const pages = await db.page.findMany({
      where: { pageType: null },
      select: { id: true, slug: true },
      take: BATCH,
      skip: offset,
    });
    if (pages.length === 0) break;

    for (const page of pages) {
      const latest = await db.pageVersion.findFirst({
        where: { pageId: page.id },
        orderBy: { createdAt: "desc" },
        select: { yamlContent: true },
      });
      if (!latest) { skip++; continue; }

      const pt = extractDeclaredPageType(latest.yamlContent);
      if (!pt) { skip++; continue; }

      await db.page.update({ where: { id: page.id }, data: { pageType: pt } });
      filled++;
    }

    if (pages.length < BATCH) break;
    offset += BATCH;
  }

  console.log(`backfill-page-type: ${filled} filled, ${skip} skipped (no content or no pageType declared)`);
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
