import yaml from "js-yaml";
import { createHash } from "crypto";
import { db } from "./db";
import type { Prisma } from "@/generated/prisma/client";
import { ensureComponentIds } from "./component-ids";
import { hasDashboardBlock, contextHeader } from "./glance-prompts";
import type { GlanceContext } from "./glance-prompts";
import { listPagesWhere, defaultPageVisibility } from "./access";

export interface PageMeta {
  slug: string;
  title: string;
  annotationCount: number;
  pendingAnnotationCount: number;
  viewCount: number;
  updatedAt: Date;
  lastActivity: Date;
  lastEditedBy: string;
  folderId: string | null;
  visibility: string;
  snippet: string;
  createdBy: string;
  sortOrder: number | null;
  pinned: boolean;
  status: string;
  freshness: "fresh" | "due" | "overdue" | null;
  staleReason: string | null;
}

/// Bump view stats without touching updatedAt. Prisma's @updatedAt fires on
/// every update, so a normal increment would make "recently updated" mean
/// "recently looked at" — raw SQL keeps the content clock honest.
export async function bumpViewCount(pageId: string): Promise<void> {
  await db.$executeRaw`UPDATE pages SET view_count = view_count + 1, last_viewed_at = now() WHERE id = ${pageId}`;
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
  const where = listPagesWhere(orgId, userId ?? null);

  const pages = await db.page.findMany({
    where,
    include: {
      _count: {
        select: {
          annotations: true,
          // Pending = anything a human hasn't dispositioned yet.
        },
      },
      annotations: {
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, status: true },
      },
      versions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { jsonContent: true, createdBy: true },
      },
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
    const pendingAnnotationCount = p.annotations.filter(
      (a) => a.status !== "incorporated" && a.status !== "ignored"
    ).length;

    let snippet = p.title;
    const latestVersion = p.versions[0];
    if (latestVersion?.jsonContent) {
      const json = latestVersion.jsonContent as Record<string, unknown>;
      const raw = (json.subtitle as string) || (json.description as string) || "";
      if (raw) {
        snippet = raw.length > 120 ? raw.slice(0, 117) + "..." : raw;
      }
    }

    const [freshness, staleReason] = staleness(
      latestVersion?.jsonContent as Record<string, unknown> | null,
      p.updatedAt,
      p.lastViewedAt
    );

    return {
      slug: p.slug,
      title: p.title,
      annotationCount: p._count.annotations,
      pendingAnnotationCount,
      viewCount: p.viewCount,
      updatedAt: p.updatedAt,
      lastActivity,
      lastEditedBy: latestVersion?.createdBy ?? p.createdBy,
      folderId: p.folderId,
      visibility: p.visibility,
      snippet,
      createdBy: p.createdBy,
      sortOrder: p.sortOrder,
      pinned: p.pinned,
      status: p.status,
      freshness,
      staleReason,
    };
  });

  return mapped;
}

/// True when the page content contains a task tree with unfinished nodes —
/// the signal that a "plan" page claims ongoing work.
function hasOpenTasks(json: Record<string, unknown> | null): boolean {
  if (!json) return false;
  let open = false;
  function walkNodes(nodes: unknown) {
    if (!Array.isArray(nodes) || open) return;
    for (const n of nodes as Record<string, unknown>[]) {
      const st = (n.status as string) ?? "default";
      if (st !== "completed") {
        open = true;
        return;
      }
      walkNodes(n.children);
    }
  }
  function walkComponents(comps: unknown) {
    if (!Array.isArray(comps) || open) return;
    for (const c of comps as Record<string, unknown>[]) {
      if (c.type === "tree") walkNodes(c.nodes);
      walkComponents(c.components);
      if (Array.isArray(c.tabs)) {
        for (const t of c.tabs as Record<string, unknown>[]) walkComponents(t.components);
      }
    }
  }
  walkComponents(json.components);
  return open;
}

const DAY_MS = 86400000;

/// Staleness signal: explicit freshness metadata wins; otherwise cheap
/// passive heuristics. Returns [state, human-readable reason]. These are
/// hints for the dashboard and seed data for the cleanup audit — they never
/// auto-flag anything.
function staleness(
  json: Record<string, unknown> | null,
  updatedAt: Date,
  lastViewedAt: Date | null
): ["fresh" | "due" | "overdue" | null, string | null] {
  const explicit = freshnessStatus(json, updatedAt);
  if (explicit) {
    return [
      explicit,
      explicit === "fresh" ? null : "past its review cadence",
    ];
  }
  const contentAgeDays = (Date.now() - updatedAt.getTime()) / DAY_MS;
  if (contentAgeDays > 60 && hasOpenTasks(json)) {
    return ["overdue", "open tasks but no content change in 60+ days"];
  }
  // Only trust the view signal once we have one — lastViewedAt ships null
  // for every page that predates the column.
  if (lastViewedAt && (Date.now() - lastViewedAt.getTime()) / DAY_MS > 60) {
    return ["due", "no views in 60+ days"];
  }
  return [null, null];
}

/// Freshness from the page's kazam metadata when present: `freshness.review_every`
/// (weekly/monthly/quarterly/yearly or Nd/Nw/Nm/Ny) measured against the page's
/// last content update. Pages without freshness metadata return null — no badge.
function freshnessStatus(
  json: Record<string, unknown> | null,
  updatedAt: Date
): "fresh" | "due" | "overdue" | null {
  const f = json?.freshness as Record<string, unknown> | undefined;
  if (!f || typeof f !== "object") return null;
  const cadence = f.review_every as string | undefined;
  if (!cadence) return null;

  const cadenceMap: Record<string, number> = {
    weekly: 7, monthly: 30, quarterly: 90, yearly: 365, annually: 365,
  };
  let days = cadenceMap[cadence];
  if (!days) {
    const m = cadence.match(/^(\d+)(d|w|m|y)$/);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    days = m[2] === "d" ? n : m[2] === "w" ? n * 7 : m[2] === "m" ? n * 30 : n * 365;
  }

  const base = typeof f.updated === "string" ? new Date(f.updated) : updatedAt;
  const elapsed = (Date.now() - base.getTime()) / 86400000;
  if (elapsed > days) return "overdue";
  if (elapsed > days * 0.8) return "due";
  return "fresh";
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

export interface SearchResult {
  slug: string;
  title: string;
  matches: string[];
  type: "page" | "prompt";
  prompt?: string;
}

export async function searchPages(
  orgId: string,
  query: string,
  userId?: string,
  glanceCtx: GlanceContext = {}
): Promise<SearchResult[]> {
  const where = listPagesWhere(orgId, userId ?? null);

  const pages = await db.page.findMany({
    where,
    select: {
      slug: true,
      title: true,
      dashboardEnabled: true,
      versions: { orderBy: { createdAt: "desc" as const }, take: 1, select: { yamlContent: true, jsonContent: true } },
    },
  });

  const q = query.toLowerCase();
  const results: SearchResult[] = [];

  for (const page of pages) {
    if (page.versions.length === 0) continue;
    const content = page.versions[0].yamlContent;
    const json = page.versions[0].jsonContent as Record<string, unknown> | null;

    const titleMatch = page.title.toLowerCase().includes(q);
    const contentMatch = content.toLowerCase().includes(q);
    if (!titleMatch && !contentMatch) continue;

    const lines = content.split("\n");
    const matches = lines
      .filter((l) => l.toLowerCase().includes(q))
      .slice(0, 5)
      .map((l) => l.trim());

    const isDashboard = page.dashboardEnabled && json && hasDashboardBlock(json);
    const dashBlock = isDashboard ? (json!.dashboard as { prompt: string; title?: string; description?: string }) : null;

    const rawPrompt = dashBlock?.prompt;
    const wrappedPrompt = rawPrompt
      ? `${contextHeader(glanceCtx)}\n\nWorkflow page: read_page("${page.slug}") for full steps.\n\n${rawPrompt.trim()}`
      : undefined;

    results.push({
      slug: page.slug,
      title: dashBlock?.title ?? page.title,
      matches: titleMatch && matches.length === 0 ? [dashBlock?.description ?? page.title] : matches,
      type: isDashboard ? "prompt" : "page",
      prompt: wrappedPrompt,
    });

    if (page.slug === "home" && json) {
      const prompts = json.prompts as Array<{ title: string; prompt: string; description?: string }> | undefined;
      if (Array.isArray(prompts)) {
        for (const p of prompts) {
          if (!p?.title || !p?.prompt) continue;
          const pMatch = p.title.toLowerCase().includes(q) ||
            (p.description ?? "").toLowerCase().includes(q) ||
            p.prompt.toLowerCase().includes(q);
          if (!pMatch) continue;
          results.push({
            slug: "home",
            title: p.title,
            matches: [p.description ?? "Custom prompt"],
            type: "prompt",
            prompt: `${contextHeader(glanceCtx)}\n\n${p.prompt.trim()}`,
          });
        }
      }
    }
  }

  return results;
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
  const dashboardEnabled = jsonContent
    ? hasDashboardBlock(jsonContent as Record<string, unknown>)
    : false;

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

    const pageUpdateData: Record<string, unknown> = { title, updatedAt: new Date(), dashboardEnabled };
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
      visibility: defaultPageVisibility(),
      dashboardEnabled,
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
  let jsonContent: Record<string, unknown> | undefined;
  try {
    jsonContent = yaml.load(content) as Record<string, unknown>;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Invalid YAML: ${msg}` };
  }
  let yamlContent = content;

  if (jsonContent && Array.isArray(jsonContent.components)) {
    jsonContent = { ...jsonContent, components: ensureComponentIds(jsonContent.components as Record<string, unknown>[]) };
    yamlContent = yaml.dump(jsonContent, { lineWidth: -1, noRefs: true });
  }

  const title = (jsonContent?.title as string) || extractTitle(content, slug);
  return _writePageInternal(orgId, orgSlug, slug, yamlContent, jsonContent as Prisma.InputJsonValue | undefined, title, createdBy, expectedHash, sortOrder);
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
  let stamped = json;
  if (Array.isArray(json.components)) {
    stamped = { ...json, components: ensureComponentIds(json.components as Record<string, unknown>[]) };
  }
  const yamlContent = yaml.dump(stamped, { lineWidth: -1, noRefs: true });
  const title = (stamped.title as string) || slug;
  return _writePageInternal(orgId, orgSlug, slug, yamlContent, stamped as Prisma.InputJsonValue, title, createdBy, expectedHash, sortOrder);
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
