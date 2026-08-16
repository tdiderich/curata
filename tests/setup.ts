import { beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

function createTestClient(): PrismaClient {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5555/curata_test",
  });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

export const testDb = createTestClient();

beforeEach(async () => {
  // Truncate all tables in dependency order. Fire-and-forget writes from the
  // previous test (view-count bumps, version pruning, non-fatal sweeps) can
  // still hold row locks when this runs, which surfaces as a 40P01 deadlock
  // against the TRUNCATE's table locks. Those stragglers finish in
  // milliseconds, so a short bounded retry absorbs the race instead of
  // failing whichever unlucky test drew it.
  for (let attempt = 1; ; attempt++) {
    try {
      await testDb.$executeRawUnsafe(
        `TRUNCATE annotations, api_keys, page_versions, pages, folders, group_members, groups, org_members, organizations CASCADE`
      );
      break;
    } catch (err) {
      const deadlocked = err instanceof Error && err.message.includes("40P01");
      if (!deadlocked || attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 100 * attempt));
    }
  }
});

afterAll(async () => {
  await testDb.$disconnect();
});
