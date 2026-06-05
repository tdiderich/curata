import { db } from "./db";
import { seedGettingStartedPage } from "./seed-page";
import { generateFunSlug } from "./slug-words";
import yaml from "js-yaml";
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import type { Prisma } from "@/generated/prisma/client";

async function findOrCreateFolder(orgId: string, name: string): Promise<string> {
  const existing = await db.folder.findFirst({ where: { orgId, name } });
  if (existing) return existing.id;
  const created = await db.folder.create({
    data: { orgId, name, visibility: "shared", createdBy: "system" },
  });
  return created.id;
}

async function seedPagesFromDir(orgId: string, folderId: string, dirPath: string): Promise<void> {
  if (!fs.existsSync(dirPath)) {
    console.log(`[seed] directory not found, skipping: ${dirPath}`);
    return;
  }
  let files: string[];
  try {
    files = fs.readdirSync(dirPath).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  } catch (err) {
    console.error(`[seed] failed to read directory ${dirPath}:`, err);
    return;
  }
  for (const file of files) {
    const slug = path.basename(file, path.extname(file));
    try {
      const existing = await db.page.findUnique({ where: { orgId_slug: { orgId, slug } } });
      if (existing) {
        console.log(`[seed] skipping existing page: ${slug}`);
        continue;
      }
      const yamlContent = fs.readFileSync(path.join(dirPath, file), "utf-8");
      const parsed = yaml.load(yamlContent) as Record<string, unknown>;
      const title = typeof parsed?.title === "string" ? parsed.title : slug;
      const contentHash = createHash("sha256").update(yamlContent).digest("hex");
      await db.page.create({
        data: {
          orgId,
          slug,
          title,
          folderId,
          createdBy: "system",
          versions: {
            create: {
              yamlContent,
              jsonContent: parsed as unknown as Prisma.InputJsonValue,
              contentHash,
              createdBy: "system",
            },
          },
        },
      });
      console.log(`[seed] created page: ${slug}`);
    } catch (err) {
      console.error(`[seed] failed to seed page ${slug}:`, err);
    }
  }
}

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

  await seedOrgContent(org.id);

  return { id: org.id, slug: org.slug };
}

export async function seedOrgContent(orgId: string): Promise<void> {
  await seedGettingStartedPage(orgId, "system").catch(err =>
    console.error("[seed] getting-started page failed:", err)
  );

  try {
    const workflowsFolderId = await findOrCreateFolder(orgId, "Workflows");
    await seedPagesFromDir(orgId, workflowsFolderId, path.join(process.cwd(), "seed", "workflows"));
  } catch (err) {
    console.error("[seed] workflows folder/pages failed:", err);
  }

  try {
    const templatesFolderId = await findOrCreateFolder(orgId, "Templates");
    await seedPagesFromDir(orgId, templatesFolderId, path.join(process.cwd(), "seed", "templates"));
  } catch (err) {
    console.error("[seed] templates folder/pages failed:", err);
  }
}
