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
  // Truncate all tables in dependency order
  await testDb.$executeRawUnsafe(
    `TRUNCATE annotations, api_keys, page_versions, pages, folders, org_members, organizations CASCADE`
  );
});

afterAll(async () => {
  await testDb.$disconnect();
});
