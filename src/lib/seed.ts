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

/**
 * Seeds pages from a seed directory into the managed folder, keeping them
 * tracking shipped content:
 *
 * - Missing page: created with seeded=true.
 * - Existing page still in this folder whose content drifted: refreshed.
 * - Existing page moved OUT of this folder: never touched.
 * - Active seeded page whose seed file no longer ships (and isn't in
 *   preserveSlugs): archived.
 * - Trusted pointer follows refreshed content silently.
 */
async function seedPagesFromDir(
  orgId: string,
  folderId: string,
  dirPath: string,
  preserveSlugs: string[] = []
): Promise<void> {
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
  const seededSlugs = new Set<string>(preserveSlugs);
  for (const file of files) {
    const slug = path.basename(file, path.extname(file));
    seededSlugs.add(slug);
    try {
      const yamlContent = fs.readFileSync(path.join(dirPath, file), "utf-8");
      const parsed = yaml.load(yamlContent) as Record<string, unknown>;
      const title = typeof parsed?.title === "string" ? parsed.title : slug;
      const contentHash = createHash("sha256").update(yamlContent).digest("hex");

      const existing = await db.page.findUnique({
        where: { orgId_slug: { orgId, slug } },
        select: {
          id: true,
          folderId: true,
          status: true,
          seeded: true,
          trustedVersionId: true,
          versions: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, contentHash: true } },
        },
      });
      if (existing) {
        if (existing.folderId !== folderId) {
          console.log(`[seed] skipping relocated page: ${slug}`);
          continue;
        }
        const latest = existing.versions[0];
        const latestMatchesSeed = latest?.contentHash === contentHash;
        // A trusted pointer parked on an older version pins trusted-channel
        // reads (the read_page default) to stale content even after a
        // refresh lands, so pointer currency is part of "up to date" here.
        const trustedCurrent = !existing.trustedVersionId || (latest && existing.trustedVersionId === latest.id);
        if (latestMatchesSeed && existing.status === "active" && trustedCurrent && existing.seeded) {
          continue;
        }
        // Archived-but-current pages just reactivate; only a real content
        // change earns a new version.
        let currentVersionId = latest?.id;
        if (!latestMatchesSeed) {
          const created = await db.pageVersion.create({
            data: {
              pageId: existing.id,
              yamlContent,
              jsonContent: parsed as unknown as Prisma.InputJsonValue,
              contentHash,
              createdBy: "system",
            },
          });
          currentVersionId = created.id;
        }
        // Trust stays opt-in: a never-trusted page keeps a null pointer. But
        // where a human already trusted this curata-managed page, the pointer
        // follows the shipped content — silently, no audit entry, so digests
        // never report these as human trust flips.
        await db.page.update({
          where: { id: existing.id },
          data: {
            title,
            status: "active",
            seeded: true,
            ...(existing.trustedVersionId && currentVersionId ? { trustedVersionId: currentVersionId } : {}),
          },
        });
        console.log(`[seed] refreshed page: ${slug}`);
        continue;
      }
      await db.page.create({
        data: {
          orgId,
          slug,
          title,
          folderId,
          createdBy: "system",
          seeded: true,
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

  // Retire seeded pages this folder no longer ships. Only targets pages
  // with seeded=true so org-custom pages in the same locked folder are
  // never touched by the sweep.
  try {
    const strays = await db.page.findMany({
      where: {
        orgId,
        folderId,
        status: "active",
        seeded: true,
        slug: { notIn: [...seededSlugs] },
      },
      select: { id: true, slug: true },
    });
    for (const stray of strays) {
      await db.page.update({ where: { id: stray.id }, data: { status: "archived" } });
      console.log(`[seed] archived retired seed page: ${stray.slug}`);
    }
  } catch (err) {
    console.error(`[seed] retired-page sweep failed for folder ${folderId}:`, err);
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

const MANAGED_FOLDER = "Curata Managed Pages";
const SEED_DIRS = ["getting-started", "workflows", "templates"];
const OLD_SEED_FOLDERS = ["Getting Started", "Skills", "Templates", "Workflows"];

function collectSeedSlugs(): string[] {
  const slugs: string[] = [];
  for (const dir of SEED_DIRS) {
    const full = path.join(process.cwd(), "seed", dir);
    if (!fs.existsSync(full)) continue;
    try {
      for (const f of fs.readdirSync(full)) {
        if (f.endsWith(".yaml") || f.endsWith(".yml")) {
          slugs.push(path.basename(f, path.extname(f)));
        }
      }
    } catch {}
  }
  return slugs;
}

async function findOrCreateManagedFolder(orgId: string): Promise<string> {
  const existing = await db.folder.findFirst({ where: { orgId, name: MANAGED_FOLDER } });
  if (existing) {
    if (!existing.locked) {
      await db.folder.update({ where: { id: existing.id }, data: { locked: true } });
    }
    return existing.id;
  }
  const created = await db.folder.create({
    data: { orgId, name: MANAGED_FOLDER, visibility: "org", createdBy: "system", locked: true },
  });
  return created.id;
}

async function migrateOldSeedFolders(orgId: string, managedFolderId: string): Promise<void> {
  const oldFolders = await db.folder.findMany({
    where: { orgId, name: { in: OLD_SEED_FOLDERS }, locked: true },
  });
  for (const folder of oldFolders) {
    if (folder.id === managedFolderId) continue;
    try {
      await db.page.updateMany({
        where: { orgId, folderId: folder.id, seeded: true },
        data: { folderId: managedFolderId },
      });
      await db.folder.update({ where: { id: folder.id }, data: { locked: false } });
      const remaining = await db.page.count({
        where: { folderId: folder.id, status: { not: "archived" } },
      });
      if (remaining === 0) {
        await db.folder.delete({ where: { id: folder.id } });
        console.log(`[seed] deleted empty old seed folder: ${folder.name}`);
      } else {
        console.log(`[seed] unlocked old seed folder (has user content): ${folder.name}`);
      }
    } catch (err) {
      console.error(`[seed] migration failed for folder ${folder.name}:`, err);
    }
  }
}

export async function seedOrgContent(orgId: string): Promise<void> {
  const managedFolderId = await findOrCreateManagedFolder(orgId);
  // All seed dirs share one folder — pass every slug as preserveSlugs so
  // per-dir retire sweeps don't archive pages from sibling dirs.
  const allSlugs = ["getting-started", ...collectSeedSlugs()];

  try {
    await seedGettingStartedPage(orgId, "system", managedFolderId);
    await seedPagesFromDir(orgId, managedFolderId, path.join(process.cwd(), "seed", "getting-started"), allSlugs);
  } catch (err) {
    console.error("[seed] getting-started pages failed:", err);
  }

  try {
    await seedPagesFromDir(orgId, managedFolderId, path.join(process.cwd(), "seed", "workflows"), allSlugs);
  } catch (err) {
    console.error("[seed] skill pages failed:", err);
  }

  try {
    await seedPagesFromDir(orgId, managedFolderId, path.join(process.cwd(), "seed", "templates"), allSlugs);
  } catch (err) {
    console.error("[seed] template pages failed:", err);
  }

  try {
    await findOrCreateFolder(orgId, "Quick Actions", true);
  } catch (err) {
    console.error("[seed] quick-actions folder failed:", err);
  }

  await migrateOldSeedFolders(orgId, managedFolderId);
}

// seedOrgContent runs at org creation only (seedOrg above). An org created
// before a seed page existed never gets it without a backfill. Re-running
// against an existing org is safe: seeded pages are refreshed, relocated
// pages are never touched, user-created pages are never touched, and old
// seed folders are migrated into the unified "Curata Managed Pages" folder.
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
