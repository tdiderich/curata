/**
 * One-off: backfill trust rules for pages/folders/orgs that already have
 * approval rules. The trust mode redesign defaults everything to "auto"
 * (latest is trusted), but existing approval rules imply "locked" was the
 * intent — this script adds { id: "trust", kind: "trust", mode: "locked" }
 * to any rules JSON that has an approval rule but no trust rule.
 *
 * Safe to re-run: skips any entity that already has a trust rule.
 *
 * Run: npx tsx scripts/migrate-trust-rules.ts
 */
import { db } from "../src/lib/db";
import { Prisma } from "../src/generated/prisma/client";

const TRUST_RULE = { id: "trust", kind: "trust", mode: "locked" };

function hasApprovalRule(rules: unknown): boolean {
  if (!Array.isArray(rules)) return false;
  return rules.some((r: Record<string, unknown>) => r.kind === "approval");
}

function hasTrustRule(rules: unknown): boolean {
  if (!Array.isArray(rules)) return false;
  return rules.some((r: Record<string, unknown>) => r.kind === "trust");
}

function addTrustRule(rules: unknown): unknown[] {
  const arr = Array.isArray(rules) ? [...rules] : [];
  arr.push(TRUST_RULE);
  return arr;
}

async function main() {
  let orgsUpdated = 0;
  let foldersUpdated = 0;
  let pagesUpdated = 0;

  const orgs = await db.organization.findMany({ select: { id: true, slug: true, rules: true } });
  for (const org of orgs) {
    if (hasApprovalRule(org.rules) && !hasTrustRule(org.rules)) {
      await db.organization.update({
        where: { id: org.id },
        data: { rules: addTrustRule(org.rules) as unknown as Prisma.InputJsonValue },
      });
      orgsUpdated++;
      console.log(`  org ${org.slug}: added trust rule`);
    }
  }

  const folders = await db.folder.findMany({ select: { id: true, name: true, rules: true } });
  for (const folder of folders) {
    if (hasApprovalRule(folder.rules) && !hasTrustRule(folder.rules)) {
      await db.folder.update({
        where: { id: folder.id },
        data: { rules: addTrustRule(folder.rules) as unknown as Prisma.InputJsonValue },
      });
      foldersUpdated++;
      console.log(`  folder "${folder.name}": added trust rule`);
    }
  }

  const pages = await db.page.findMany({
    where: { status: "active" },
    select: { id: true, slug: true, rules: true },
  });
  for (const page of pages) {
    if (hasApprovalRule(page.rules) && !hasTrustRule(page.rules)) {
      await db.page.update({
        where: { id: page.id },
        data: { rules: addTrustRule(page.rules) as unknown as Prisma.InputJsonValue },
      });
      pagesUpdated++;
      console.log(`  page ${page.slug}: added trust rule`);
    }
  }

  console.log(`\nDone. Updated ${orgsUpdated} org(s), ${foldersUpdated} folder(s), ${pagesUpdated} page(s).`);
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
