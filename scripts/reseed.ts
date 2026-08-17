import { db } from "@/lib/db";
import { seedOrgContent } from "@/lib/seed";

async function main() {
  const org = await db.organization.findFirst({ select: { id: true, slug: true } });
  if (!org) {
    console.log("no org found");
    process.exit(1);
  }
  console.log("re-seeding:", org.slug);
  await seedOrgContent(org.id);
  console.log("seed complete");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
