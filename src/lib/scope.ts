import { db } from "./db";
import { Prisma } from "@/generated/prisma/client";
import {
  findConceptForTerm,
  normalizeExternalUrl,
  normalizeTerm,
  upsertConcepts,
  upsertExternalDependents,
} from "./concepts";
import { defaultAssetLabel } from "./scan";
import { parseCheckRecipe, suggestCheck, type CheckRecipe } from "./check-recipes";
export { parseCheckRecipe, suggestCheck, type CheckRecipe } from "./check-recipes";
import { getChartNode, type ChartChild } from "./chart";

/**
 * Scope: the children a node has that curata could not find on its own,
 * almost always external. Suggestions come from the inventory (layer 1);
 * a human or agent promotes one with a click. Recipes tell an agent how to
 * check an external asset through its own MCPs. Curata never holds the
 * credentials; the agent brings the hands.
 */

export interface PageSuggestion {
  slug: string;
  title: string;
  /** What in its body matched: the source page's title or the term's last segment. */
  matched: string;
}

export interface ScopeSuggestion {
  url: string;
  label: string;
  host: string | null;
  /** Where the suggestion came from, in order of confidence. */
  why: "in source body" | "in a child's body" | "declared by a sibling";
  referencedBy: number;
  suggestedCheck: CheckRecipe | null;
}

function hostOf(url: string): string | null {
  try { return new URL(url).host.replace(/^www\./, ""); } catch { return null; }
}

/**
 * Pages that mention this node by name but aren't under it. The chart can
 * only see mapped pages; this is how it points at the unmapped ones. Match
 * is a plain case-insensitive substring on the latest body for the source
 * page's title, the term's last segment, and the term's namespace (pricing
 * in pricing/tier-2), dashes turned to spaces. Structural namespaces
 * (feature, product, launch, group...) are skipped: "feature" matching
 * every page is noise, "pricing" matching every page is the point.
 */
const STRUCTURAL_NAMESPACES = new Set(["feature", "features", "product", "products", "launch", "group", "template", "component", "messaging", "process", "api", "doc", "docs", "page", "pages", "project", "topic", "team", "internal"]);
export async function getPageSuggestions(orgId: string, term: string): Promise<PageSuggestion[]> {
  const node = await getChartNode(orgId, term);
  const under = new Set(node.children.filter((c) => c.slug).map((c) => c.slug!));
  if (node.source) under.add(node.source.slug);
  const segs = normalizeTerm(term).split("/");
  const parts = segs.filter((s, i) => i === segs.length - 1 || !STRUCTURAL_NAMESPACES.has(s)).map((s) => s.replace(/-/g, " ").trim());
  const needles = [...new Set([node.source?.title ?? "", ...parts].map((s) => s.trim()).filter((s) => s.length >= 4))];
  if (needles.length === 0) return [];
  const pages = await db.page.findMany({
    where: { orgId, status: { not: "archived" }, slug: { notIn: [...under] } },
    select: { slug: true, title: true, versions: { orderBy: { createdAt: "desc" }, take: 1, select: { yamlContent: true } } },
  });
  const out: PageSuggestion[] = [];
  for (const p of pages) {
    const body = (p.versions[0]?.yamlContent ?? "").toLowerCase();
    const hit = needles.find((n) => body.includes(n.toLowerCase()));
    if (hit) out.push({ slug: p.slug, title: p.title, matched: hit });
  }
  return out;
}

/** External URLs that probably belong under this node but aren't declared yet. */
export async function getScopeSuggestions(orgId: string, term: string): Promise<ScopeSuggestion[]> {
  const node = await getChartNode(orgId, term);
  const declared = new Set(node.children.filter((c) => c.kind === "external").map((c) => c.url));
  const out = new Map<string, ScopeSuggestion>();
  const add = (rows: Array<{ asset: { url: string; label: string; refs?: unknown[] } ; count?: number }>, why: ScopeSuggestion["why"]) => {
    for (const r of rows) {
      if (declared.has(r.asset.url) || out.has(r.asset.url)) continue;
      out.set(r.asset.url, { url: r.asset.url, label: r.asset.label, host: hostOf(r.asset.url), why, referencedBy: r.count ?? 1, suggestedCheck: suggestCheck(r.asset.url) });
    }
  };

  const sourcePageId = node.source ? (await db.page.findUnique({ where: { orgId_slug: { orgId, slug: node.source.slug } }, select: { id: true, folderId: true } })) : null;
  if (sourcePageId) {
    const refs = await db.externalRef.findMany({ where: { pageId: sourcePageId.id }, select: { asset: { select: { url: true, label: true, _count: { select: { refs: true } } } } } });
    add(refs.map((r) => ({ asset: r.asset, count: r.asset._count.refs })), "in source body");
  }

  const childSlugs = node.children.filter((c) => c.kind === "page" && c.slug).map((c) => c.slug!);
  if (childSlugs.length > 0) {
    const refs = await db.externalRef.findMany({
      where: { page: { orgId, slug: { in: childSlugs } } },
      select: { asset: { select: { url: true, label: true, _count: { select: { refs: true } } } } },
    });
    add(refs.map((r) => ({ asset: r.asset, count: r.asset._count.refs })), "in a child's body");
  }

  if (sourcePageId?.folderId) {
    // What other source pages in the same folder declared as scope.
    const siblings = await db.pageConcept.findMany({
      where: { rel: "asserts", page: { orgId, folderId: sourcePageId.folderId, id: { not: sourcePageId.id } } },
      select: { conceptId: true },
    });
    if (siblings.length > 0) {
      const edges = await db.externalEdge.findMany({
        where: { conceptId: { in: siblings.map((s) => s.conceptId) }, asset: { orgId } },
        select: { asset: { select: { url: true, label: true, _count: { select: { refs: true } } } } },
      });
      add(edges.map((e) => ({ asset: e.asset, count: e.asset._count.refs })), "declared by a sibling");
    }
  }
  return [...out.values()];
}

export interface AddScopeInput {
  slug?: string;
  url?: string;
  label?: string;
  owner?: string;
  dueAt?: string | null;
  check?: unknown;
}

function parseDue(raw: string | null | undefined): Date | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new Error(`due_at is not a valid date: ${JSON.stringify(raw)}`);
  return d;
}

/** Put a page or an external URL under a node. Same edges map_dependencies writes. */
export async function addScopeItem(orgId: string, term: string, input: AddScopeInput, createdBy: string): Promise<ChartChild> {
  if (!input.slug && !input.url) throw new Error("slug or url is required");
  const normalized = normalizeTerm(term);
  if (!(await findConceptForTerm(term, normalized))) {
    throw new Error(`concept not found: ${normalized}. add_to_chart only adds under an existing top level item; make one with set_chart_node slug=<source page> (or map_dependencies for bulk), then add.`);
  }
  if (input.slug) {
    const page = await db.page.findUnique({ where: { orgId_slug: { orgId, slug: input.slug } }, select: { id: true } });
    if (!page) throw new Error(`page not found: ${input.slug}`);
    await upsertConcepts(page.id, [{ term, rel: "depends" }], createdBy, { verified: false });
  } else {
    const url = normalizeExternalUrl(input.url!);
    const due = parseDue(input.dueAt);
    const check = parseCheckRecipe(input.check);
    await upsertExternalDependents(orgId, term, [{ url, label: input.label?.trim() || defaultAssetLabel(url), owner: input.owner }], createdBy);
    const concept = await findConceptForTerm(term, normalized);
    const asset = await db.externalAsset.findUnique({ where: { orgId_url: { orgId, url } }, select: { id: true } });
    if (concept && asset) {
      if (due !== undefined) await db.externalEdge.updateMany({ where: { assetId: asset.id, conceptId: concept.id }, data: { dueAt: due } });
      if (check) await db.externalAsset.update({ where: { id: asset.id }, data: { check: check as unknown as Prisma.InputJsonValue } });
    }
  }
  const node = await getChartNode(orgId, term);
  const child = node.children.find((c) => (input.slug ? c.slug === input.slug : c.url === normalizeExternalUrl(input.url!)));
  if (!child) throw new Error("added, but the row did not come back; refresh");
  return child;
}

export interface UpdateScopeInput {
  url: string;
  /** Scope the due date to this node's edge. Omitted: every edge the asset carries. */
  term?: string;
  label?: string;
  owner?: string | null;
  dueAt?: string | null;
  check?: unknown;
}

/** Owner, label and recipe live on the asset (shared across nodes); due lives on the edge. */
export async function updateScopeItem(orgId: string, input: UpdateScopeInput): Promise<{ url: string; owner: string | null; label: string; check: CheckRecipe | null; dueAt: string | null }> {
  const url = normalizeExternalUrl(input.url);
  const asset = await db.externalAsset.findUnique({ where: { orgId_url: { orgId, url } }, select: { id: true } });
  if (!asset) throw new Error(`external asset not found: ${url}. add it to a node first`);
  const data: { owner?: string | null; label?: string; check?: Prisma.InputJsonValue | typeof Prisma.DbNull } = {};
  if (input.owner !== undefined) data.owner = input.owner?.trim() || null;
  if (input.label !== undefined && input.label.trim()) data.label = input.label.trim();
  if (input.check !== undefined) {
    const recipe = parseCheckRecipe(input.check);
    data.check = recipe ? (recipe as unknown as Prisma.InputJsonValue) : Prisma.DbNull;
  }
  const due = parseDue(input.dueAt);
  const updated = await db.externalAsset.update({ where: { id: asset.id }, data, select: { url: true, owner: true, label: true, check: true } });
  let edgeDue: Date | null = null;
  if (due !== undefined) {
    const where: { assetId: string; conceptId?: string } = { assetId: asset.id };
    if (input.term) {
      const concept = await findConceptForTerm(input.term, normalizeTerm(input.term));
      if (!concept) throw new Error(`concept not found: ${input.term}`);
      where.conceptId = concept.id;
    }
    await db.externalEdge.updateMany({ where, data: { dueAt: due } });
    edgeDue = due;
  }
  return { url: updated.url, owner: updated.owner, label: updated.label, check: (updated.check as CheckRecipe | null) ?? null, dueAt: edgeDue?.toISOString() ?? null };
}

export async function removeScopeItem(orgId: string, term: string, input: { slug?: string; url?: string }, createdBy: string): Promise<{ removed: boolean }> {
  if (!input.slug && !input.url) throw new Error("slug or url is required");
  const concept = await findConceptForTerm(term, normalizeTerm(term));
  if (!concept) throw new Error(`concept not found: ${normalizeTerm(term)}`);
  if (input.slug) {
    const page = await db.page.findUnique({ where: { orgId_slug: { orgId, slug: input.slug } }, select: { id: true } });
    if (!page) throw new Error(`page not found: ${input.slug}`);
    const had = await db.pageConcept.count({ where: { pageId: page.id, conceptId: concept.id } });
    if (had === 0) return { removed: false };
    await upsertConcepts(page.id, [{ term, remove: true }], createdBy);
  } else {
    const url = normalizeExternalUrl(input.url!);
    const had = await db.externalEdge.count({ where: { conceptId: concept.id, asset: { orgId, url } } });
    if (had === 0) return { removed: false };
    await upsertExternalDependents(orgId, term, [{ url, remove: true }], createdBy);
  }
  return { removed: true };
}

export interface AuditItem {
  node: string;
  url: string;
  label: string;
  owner: string | null;
  color: "yellow" | "red";
  reason: string | null;
  dueAt: string | null;
  check: CheckRecipe | null;
  suggestedCheck: CheckRecipe | null;
}

/**
 * The agent's worklist: every yellow or red external, with its recipe when
 * one exists. Run each through your MCPs, compare to the source, then
 * mark_verified url=... (holds, or needs_change with a note). Items with no
 * recipe are the human's list.
 */
export async function getAuditList(orgId: string): Promise<{ withRecipe: AuditItem[]; humanOnly: AuditItem[] }> {
  const { getNeedsLook } = await import("./chart");
  const nodes = await getNeedsLook(orgId);
  const withRecipe: AuditItem[] = [];
  const humanOnly: AuditItem[] = [];
  for (const n of nodes) for (const c of n.children) {
    if (c.kind !== "external" || c.color === "green") continue;
    const check = (c.check as CheckRecipe | null) ?? null;
    const item: AuditItem = { node: n.term, url: c.url!, label: c.label, owner: c.owner, color: c.color, reason: c.reason, dueAt: c.dueAt, check, suggestedCheck: check ? null : suggestCheck(c.url!) };
    (check ? withRecipe : humanOnly).push(item);
  }
  return { withRecipe, humanOnly };
}
