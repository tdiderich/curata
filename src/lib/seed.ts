import { db } from "./db";
import { seedGettingStartedPage } from "./seed-page";
import { generateFunSlug } from "./slug-words";

export async function seedOrg(name: string, slug?: string): Promise<{ id: string; slug: string }> {
  // Check if org already exists (idempotent)
  const existing = await db.organization.findFirst();
  if (existing) return { id: existing.id, slug: existing.slug };

  // Generate slug
  const existingRows = await db.organization.findMany({ select: { slug: true } });
  const existingSlugs = new Set(existingRows.map(r => r.slug));
  const finalSlug = slug || generateFunSlug(existingSlugs);

  // Create org with retry on slug collision
  let org = null;
  let currentSlug = finalSlug;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      org = await db.organization.create({
        data: { name, slug: currentSlug },
      });
      break;
    } catch (err: unknown) {
      const isDuplicate = err instanceof Error && err.message.includes("Unique constraint") && err.message.includes("slug");
      if (isDuplicate && attempt < 4) {
        currentSlug = generateFunSlug(existingSlugs);
        continue;
      }
      throw err;
    }
  }

  if (!org) throw new Error("Failed to create org after retries");

  // Seed getting-started page
  await seedGettingStartedPage(org.id, "system").catch(err =>
    console.error("[seed] getting-started page failed:", err)
  );

  return { id: org.id, slug: org.slug };
}
