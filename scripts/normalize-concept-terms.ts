/**
 * One-off: re-normalize existing Concept terms to the slug format
 * (lowercase letters, digits, hyphens - see normalizeTerm in lib/concepts.ts).
 *
 * "noise reduction" becomes "noise-reduction". When the slugged name collides
 * with an existing concept, page memberships merge into the survivor (the row
 * that already had the slugged name) and the duplicate row is deleted. Kind is
 * kept from whichever row has one, survivor first.
 *
 * Run: npx tsx scripts/normalize-concept-terms.ts
 */
import { db } from "../src/lib/db";
import { normalizeTerm } from "../src/lib/concepts";

async function main() {
  const concepts = await db.concept.findMany();
  let renamed = 0;
  let merged = 0;

  for (const c of concepts) {
    const slug = normalizeTerm(c.normalizedName);
    if (!slug || slug === c.normalizedName) continue;

    const survivor = await db.concept.findUnique({ where: { normalizedName: slug } });
    if (!survivor) {
      await db.concept.update({
        where: { id: c.id },
        data: { normalizedName: slug, displayName: slug },
      });
      renamed++;
      continue;
    }

    // Collision: move page memberships onto the survivor, then drop the dupe.
    const memberships = await db.pageConcept.findMany({ where: { conceptId: c.id } });
    for (const m of memberships) {
      await db.pageConcept.upsert({
        where: {
          pageId_conceptId_section: {
            pageId: m.pageId,
            conceptId: survivor.id,
            section: m.section,
          },
        },
        create: {
          pageId: m.pageId,
          conceptId: survivor.id,
          section: m.section,
          createdBy: m.createdBy,
        },
        update: {},
      });
    }
    await db.pageConcept.deleteMany({ where: { conceptId: c.id } });
    if (!survivor.kind && c.kind) {
      await db.concept.update({ where: { id: survivor.id }, data: { kind: c.kind } });
    }
    await db.concept.update({
      where: { id: survivor.id },
      data: { usageCount: await db.pageConcept.count({ where: { conceptId: survivor.id } }) },
    });
    await db.concept.delete({ where: { id: c.id } });
    merged++;
  }

  console.log(`normalized: ${renamed} renamed, ${merged} merged into existing concepts`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
