import { db } from "./db";
import { seedGettingStartedPage } from "./seed-page";
import { generateFunSlug } from "./slug-words";
import { DEFAULT_CONTENT_RULES } from "./content-rules";
import { DEFAULT_REQUIRED_COMPONENTS_RULES } from "./required-components";
import yaml from "js-yaml";
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import type { Prisma } from "@/generated/prisma/client";

async function findOrCreateFolder(
  orgId: string,
  name: string,
  locked = false,
  legacyNames: string[] = []
): Promise<string> {
  const existing = await db.folder.findFirst({ where: { orgId, name } });
  if (existing) {
    if (locked && !existing.locked) {
      await db.folder.update({ where: { id: existing.id }, data: { locked: true } });
    }
    return existing.id;
  }
  // A folder rename (e.g. Workflows -> Skills) needs to rename the existing
  // row in place, not create a new one alongside it: seedPagesFromDir skips
  // by slug org-wide, so pages already seeded under the old name would be
  // orphaned under the stale folder instead of following into the new one.
  for (const legacy of legacyNames) {
    const legacyFolder = await db.folder.findFirst({ where: { orgId, name: legacy } });
    if (legacyFolder) {
      const renamed = await db.folder.update({
        where: { id: legacyFolder.id },
        data: { name, locked },
      });
      return renamed.id;
    }
  }
  const created = await db.folder.create({
    data: { orgId, name, visibility: "org", createdBy: "system", locked },
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
        data: {
          name,
          slug: currentSlug,
          rules: [...DEFAULT_CONTENT_RULES, ...DEFAULT_REQUIRED_COMPONENTS_RULES] as unknown as Prisma.InputJsonValue,
        },
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
  try {
    const gettingStartedFolderId = await findOrCreateFolder(orgId, "Getting Started", true);
    await seedGettingStartedPage(orgId, "system", gettingStartedFolderId);
    await seedPagesFromDir(orgId, gettingStartedFolderId, path.join(process.cwd(), "seed", "getting-started"));
  } catch (err) {
    console.error("[seed] getting-started folder/pages failed:", err);
  }

  try {
    const skillsFolderId = await findOrCreateFolder(orgId, "Skills", true);
    await seedPagesFromDir(orgId, skillsFolderId, path.join(process.cwd(), "seed", "workflows"));
  } catch (err) {
    console.error("[seed] skills folder/pages failed:", err);
  }

  try {
    const templatesFolderId = await findOrCreateFolder(orgId, "Templates", true);
    await seedPagesFromDir(orgId, templatesFolderId, path.join(process.cwd(), "seed", "templates"));
  } catch (err) {
    console.error("[seed] templates folder/pages failed:", err);
  }
}

// seedOrgContent runs at org creation only (seedOrg above). An org created
// before a seed page existed — every batch-2 skill page, every FDE skill
// page — never gets it, because nothing re-runs the sweep for existing orgs.
// seedPagesFromDir is already skip-if-exists per slug (see above), so
// re-running the exact same sweep against an existing org is safe: it only
// ever fills gaps, it never touches a page (customized or not) whose slug
// already exists.
//
// ensureSeedPages is the lazy backfill entry point for existing orgs, called
// from a cheap high-traffic read path (mcp-dispatch's read_page — the exact
// place a thin-pointer SKILL.md 404s) the same way capture_thread calls
// ensureDefaultRequiredComponentsRules to backfill orgs older than that
// feature. Memoized in-process per org: the first caller in this process
// kicks off the sweep, every concurrent/subsequent caller in the same
// process awaits (or, once resolved, no-ops on) that same promise instead of
// re-reading the seed directories and re-querying the DB per call.
// globalThis-backed so the memo survives Next.js dev-mode module reloads,
// mirroring capture-token.ts's consumedTokens store. A failed sweep is
// evicted from the memo so the next call retries rather than being
// permanently marked done.
const g = globalThis as unknown as { __seedPagesEnsured?: Map<string, Promise<void>> };
if (!g.__seedPagesEnsured) g.__seedPagesEnsured = new Map();
const seedPagesEnsured = g.__seedPagesEnsured;

export async function ensureSeedPages(orgId: string): Promise<void> {
  let pending = seedPagesEnsured.get(orgId);
  if (!pending) {
    pending = seedOrgContent(orgId).catch((err) => {
      console.error(`[seed] ensureSeedPages failed for org ${orgId}:`, err);
      seedPagesEnsured.delete(orgId);
    });
    seedPagesEnsured.set(orgId, pending);
  }
  return pending;
}
