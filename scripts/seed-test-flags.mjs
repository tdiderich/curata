import pkg from "../src/generated/prisma/client/default.js";
const { PrismaClient } = pkg;

const db = new PrismaClient();
const pages = await db.page.findMany({
  where: { status: "active" },
  take: 3,
  orderBy: { updatedAt: "asc" },
  select: { id: true, slug: true, title: true },
});
console.log("Pages to flag:", pages.map((p) => p.slug));
for (const p of pages) {
  await db.pageFlag.create({
    data: {
      pageId: p.id,
      action: "archive",
      reason: "stale",
      evidence: "Test flag for preview pane verification.",
      confidence: "medium",
      actorId: "ts:tyler@mazehq.com",
      status: "pending",
    },
  });
}
console.log("Created", pages.length, "test flags");
await db.$disconnect();
