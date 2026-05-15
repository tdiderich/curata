import yaml from "js-yaml";
import { createHash } from "crypto";
import { db } from "./db";
import type { Prisma } from "@/generated/prisma/client";

export interface PageMeta {
  slug: string;
  title: string;
  annotationCount: number;
  viewCount: number;
  updatedAt: Date;
  lastActivity: Date;
  folderId: string | null;
  visibility: string;
  snippet: string;
  createdBy: string;
  sortOrder: number | null;
}

export interface AnnotationRow {
  id: string;
  text: string;
  author: string;
  section: string | null;
  target: string | null;
  kind: string;
  replacement: string | null;
  status: string;
  source: string;
  createdAt: Date;
}

export async function listPages(orgId: string, userId?: string): Promise<PageMeta[]> {
  const where = userId
    ? {
        orgId,
        OR: [
          { visibility: "shared" },
          { visibility: "public" },
          { visibility: "personal", createdBy: userId },
        ],
      }
    : { orgId };

  const pages = await db.page.findMany({
    where,
    include: {
      _count: { select: { annotations: true } },
      annotations: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
      versions: { orderBy: { createdAt: "desc" }, take: 1, select: { jsonContent: true } },
    },
    orderBy: [
      { sortOrder: { sort: "asc", nulls: "last" } },
      { title: "asc" },
    ],
  });

  const mapped = pages.map((p) => {
    const latestAnnotation = p.annotations[0]?.createdAt;
    const lastActivity = latestAnnotation && latestAnnotation > p.updatedAt
      ? latestAnnotation
      : p.updatedAt;

    let snippet = p.title;
    const latestVersion = p.versions[0];
    if (latestVersion?.jsonContent) {
      const json = latestVersion.jsonContent as Record<string, unknown>;
      const raw = (json.subtitle as string) || (json.description as string) || "";
      if (raw) {
        snippet = raw.length > 120 ? raw.slice(0, 117) + "..." : raw;
      }
    }

    return {
      slug: p.slug,
      title: p.title,
      annotationCount: p._count.annotations,
      viewCount: p.viewCount,
      updatedAt: p.updatedAt,
      lastActivity,
      folderId: p.folderId,
      visibility: p.visibility,
      snippet,
      createdBy: p.createdBy,
      sortOrder: p.sortOrder,
    };
  });

  return mapped;
}

export async function readPageYaml(
  orgId: string,
  slug: string
): Promise<{ yaml: string; contentHash: string } | null> {
  const page = await db.page.findUnique({
    where: { orgId_slug: { orgId, slug } },
    include: {
      versions: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  if (!page || page.versions.length === 0) return null;

  const v = page.versions[0];
  return { yaml: v.yamlContent, contentHash: v.contentHash };
}

export async function readPage(
  orgId: string,
  slug: string
): Promise<{ json: Record<string, unknown>; contentHash: string; visibility: string } | null> {
  const page = await db.page.findUnique({
    where: { orgId_slug: { orgId, slug } },
    include: {
      versions: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  if (!page || page.versions.length === 0) return null;

  const v = page.versions[0];
  const json = v.jsonContent
    ? (v.jsonContent as Record<string, unknown>)
    : (yaml.load(v.yamlContent) as Record<string, unknown>);
  return { json, contentHash: v.contentHash, visibility: page.visibility };
}

export async function searchPages(
  orgId: string,
  query: string,
  userId?: string
): Promise<Array<{ slug: string; title: string; matches: string[] }>> {
  const where = userId
    ? {
        orgId,
        OR: [
          { visibility: "shared" },
          { visibility: "public" },
          { visibility: "personal", createdBy: userId },
        ],
      }
    : { orgId };

  const pages = await db.page.findMany({
    where,
    include: {
      versions: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const q = query.toLowerCase();
  const results: Array<{ slug: string; title: string; matches: string[] }> = [];

  for (const page of pages) {
    if (page.versions.length === 0) continue;
    const content = page.versions[0].yamlContent;
    const lower = content.toLowerCase();
    if (!lower.includes(q)) continue;

    const lines = content.split("\n");
    const matches = lines
      .filter((l) => l.toLowerCase().includes(q))
      .slice(0, 5)
      .map((l) => l.trim());
    results.push({ slug: page.slug, title: page.title, matches });
  }

  return results;
}

function parseYamlToJson(content: string): Record<string, unknown> | null {
  try {
    return yaml.load(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function _writePageInternal(
  orgId: string,
  orgSlug: string,
  slug: string,
  yamlContent: string,
  jsonContent: Prisma.InputJsonValue | undefined,
  title: string,
  createdBy: string,
  expectedHash?: string,
  sortOrder?: number | null
): Promise<{ ok: true; slug: string; contentHash: string } | { ok: false; error: string }> {
  const contentHash = createHash("sha256").update(yamlContent).digest("hex");

  const existing = await db.page.findUnique({
    where: { orgId_slug: { orgId, slug } },
    include: { versions: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  if (expectedHash && existing && existing.versions.length > 0) {
    if (existing.versions[0].contentHash !== expectedHash) {
      return { ok: false, error: "conflict: page was modified since last read" };
    }
  }

  if (existing) {
    if (existing.versions.length > 0 && existing.versions[0].contentHash === contentHash && sortOrder === undefined) {
      return { ok: true, slug, contentHash };
    }

    const pageUpdateData: Record<string, unknown> = { title, updatedAt: new Date() };
    if (sortOrder !== undefined) pageUpdateData.sortOrder = sortOrder;

    await db.$transaction([
      db.pageVersion.create({
        data: { pageId: existing.id, yamlContent, jsonContent, contentHash, createdBy },
      }),
      db.page.update({
        where: { id: existing.id },
        data: pageUpdateData,
      }),
    ]);
  } else {
    const createData: Record<string, unknown> = {
      orgId,
      slug,
      title,
      createdBy,
      versions: {
        create: { yamlContent, jsonContent, contentHash, createdBy },
      },
    };
    if (sortOrder !== undefined && sortOrder !== null) createData.sortOrder = sortOrder;

    await db.page.create({ data: createData as Parameters<typeof db.page.create>[0]["data"] });
  }

  return { ok: true, slug, contentHash };
}

export async function writePage(
  orgId: string,
  orgSlug: string,
  slug: string,
  content: string,
  createdBy: string,
  expectedHash?: string,
  sortOrder?: number | null
): Promise<{ ok: true; slug: string; contentHash: string } | { ok: false; error: string }> {
  const jsonContent = (parseYamlToJson(content) ?? undefined) as Prisma.InputJsonValue | undefined;
  const title = extractTitle(content, slug);
  return _writePageInternal(orgId, orgSlug, slug, content, jsonContent, title, createdBy, expectedHash, sortOrder);
}

export async function writePageJson(
  orgId: string,
  orgSlug: string,
  slug: string,
  json: Record<string, unknown>,
  createdBy: string,
  expectedHash?: string,
  sortOrder?: number | null
): Promise<{ ok: true; slug: string; contentHash: string } | { ok: false; error: string }> {
  const yamlContent = yaml.dump(json, { lineWidth: -1, noRefs: true });
  const title = (json.title as string) || slug;
  return _writePageInternal(orgId, orgSlug, slug, yamlContent, json as Prisma.InputJsonValue, title, createdBy, expectedHash, sortOrder);
}

export async function saveAnnotation(
  orgId: string,
  orgSlug: string,
  slug: string,
  text: string,
  author: string,
  section?: string,
  target?: string,
  kind?: "note" | "edit",
  replacement?: string,
  source: "web" | "agent" | "cli" = "web"
): Promise<AnnotationRow> {
  const page = await db.page.findUnique({
    where: { orgId_slug: { orgId, slug } },
  });

  if (!page) throw new Error(`page not found: ${slug}`);

  const ann = await db.annotation.create({
    data: {
      pageId: page.id,
      text,
      author,
      section: section ?? null,
      target: target ?? null,
      kind: kind ?? "note",
      replacement: replacement ?? null,
      source,
    },
  });

  return ann;
}

export async function updateAnnotationStatus(
  orgId: string,
  orgSlug: string,
  slug: string,
  annotationId: string,
  status: "approved" | "incorporated" | "ignored"
): Promise<boolean> {
  const page = await db.page.findUnique({
    where: { orgId_slug: { orgId, slug } },
  });

  if (!page) return false;

  const ann = await db.annotation.findFirst({
    where: { id: annotationId, pageId: page.id },
  });

  if (!ann) return false;

  await db.annotation.update({
    where: { id: annotationId },
    data: { status },
  });

  return true;
}

export async function getAnnotations(
  orgId: string,
  slug: string
): Promise<AnnotationRow[]> {
  const page = await db.page.findUnique({
    where: { orgId_slug: { orgId, slug } },
    include: {
      annotations: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!page) return [];
  return page.annotations;
}

export async function getPageSections(
  orgId: string,
  slug: string
): Promise<string[]> {
  const result = await readPageYaml(orgId, slug);
  if (!result) return [];

  const doc = yaml.load(result.yaml) as Record<string, unknown>;
  const components = doc.components as Array<Record<string, unknown>> | undefined;
  if (!components) return [];

  return components
    .filter((c) => c.type === "section" && typeof c.heading === "string")
    .map((c) => c.heading as string);
}

export async function getSiteConfig(orgId: string): Promise<Record<string, unknown> | null> {
  const org = await db.organization.findFirst({ where: { id: orgId } });
  if (!org) return null;
  const config: Record<string, unknown> = { name: org.name };
  if (org.theme && org.theme !== "dark") config.theme = org.theme;
  if (org.mode && org.mode !== "dark") config.mode = org.mode;
  if (org.texture && org.texture !== "none") config.texture = org.texture;
  if (org.glow && org.glow !== "none") config.glow = org.glow;
  return config;
}

function extractTitle(yamlContent: string, fallback: string): string {
  try {
    const doc = yaml.load(yamlContent) as Record<string, unknown>;
    return (doc.title as string) || fallback;
  } catch {
    return fallback;
  }
}

export function daysAgo(dateStr: string): number {
  const d = new Date(dateStr);
  const now = new Date();
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}
