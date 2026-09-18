import { db } from "./db";
import {
  normalizeTerm,
  findConceptForTerm,
  ensureConcept,
  upsertConcepts,
  upsertExternalDependents,
  includeMap,
  getDependents,
  isStale,
  type ConceptRel,
  type DependentPage,
  type ExternalDependentRow,
} from "./concepts";

/**
 * A project's item, one row per tracked edge: the same fields the
 * dependency graph already renders (via, rel, verifiedAt, staleAgainstSource,
 * ...) plus what the graph has no room for - owner, dueDate, done, doneAt.
 * `doneStale` is true when the source moved after doneAt: the work was
 * marked shipped, then the thing it was based on changed again.
 */
export type ProjectPageItem = DependentPage & {
  itemId: string;
  dueDate: string | null;
  done: boolean;
  doneAt: string | null;
  doneBy: string | null;
  doneStale: boolean;
};
export type ProjectExternalItem = ExternalDependentRow & {
  itemId: string;
  dueDate: string | null;
  done: boolean;
  doneAt: string | null;
  doneBy: string | null;
  doneStale: boolean;
};

export interface ProjectResult {
  id: string;
  term: string;
  title: string;
  clonedFrom: string | null;
  createdAt: string;
  /** Own items: cloned independently at creation (or added since), yours to edit freely. */
  items: Array<ProjectPageItem | ProjectExternalItem>;
  /** Sub-maps this project includes (live-referenced groups), each with the project's own roll-up of it. */
  includes: Array<{ term: string; kind: string; items: Array<ProjectPageItem | ProjectExternalItem> }>;
  completion: { total: number; done: number; open: number; overdue: number };
}

async function findProject(orgId: string, term: string) {
  const normalized = normalizeTerm(term);
  const project = await db.project.findUnique({ where: { orgId_term: { orgId, term: normalized } } });
  if (!project) throw new Error(`no project for ${normalized}. Create one with createProjectFromTemplate.`);
  return project;
}

/**
 * Read a project: its own items overlaid on the live graph (so a done item
 * still shows staleAgainstSource / doneStale if the source moved again),
 * plus each included sub-map's items the same way, scoped read-only - a
 * project doesn't own a sub-map's items, it just tracks completion of its
 * own. Throws if no project exists for this term yet.
 */
export async function getProject(orgId: string, term: string): Promise<ProjectResult> {
  const project = await findProject(orgId, term);
  const [data, items] = await Promise.all([
    getDependents(orgId, { term: project.term }),
    db.projectItem.findMany({ where: { projectId: project.id } }),
  ]);

  // DependentPage/ExternalDependentRow (getDependents' output) carry no
  // underlying PageConcept/ExternalEdge id - they're shaped for the graph,
  // not for this join - so the project's own items are re-resolved directly
  // from their edges rather than matched against those rows by id.
  const ownResolved = await resolveOwnItems(orgId, project.id, items, data);

  const includesOut: ProjectResult["includes"] = [];
  for (const inc of data.includes) {
    const rows: Array<ProjectPageItem | ProjectExternalItem> = [];
    for (const d of data.dependents) {
      if (d.group !== inc.term) continue;
      // Sub-map rows are never independently tracked by this project's
      // items table (they belong to whichever project/context created
      // the include); show the live graph row as-is.
      rows.push({ ...(d as DependentPage), itemId: "", dueDate: null, done: false, doneAt: null, doneBy: null, doneStale: false });
    }
    for (const e of data.external) {
      if (e.group !== inc.term) continue;
      rows.push({ ...(e as ExternalDependentRow), itemId: "", dueDate: null, done: false, doneAt: null, doneBy: null, doneStale: false });
    }
    includesOut.push({ term: inc.term, kind: inc.kind, items: rows });
  }

  const total = ownResolved.length;
  const done = ownResolved.filter((i) => i.done).length;
  const overdue = ownResolved.filter((i) => !i.done && i.dueDate && new Date(i.dueDate) < new Date()).length;

  return {
    id: project.id,
    term: project.term,
    title: project.title,
    clonedFrom: project.clonedFrom,
    createdAt: project.createdAt.toISOString(),
    items: ownResolved,
    includes: includesOut,
    completion: { total, done, open: total - done, overdue },
  };
}

/**
 * Own items need the underlying PageConcept/ExternalEdge row id to overlay
 * done/owner/dueDate, which getDependents' output doesn't carry (it's
 * shaped for the graph, not for this join). Re-fetch the project's own
 * edges directly instead of re-deriving ids from slugs/urls.
 */
async function resolveOwnItems(
  orgId: string,
  projectId: string,
  items: Array<{ id: string; kind: string; pageConceptId: string | null; externalEdgeId: string | null; owner: string | null; dueDate: Date | null; done: boolean; doneAt: Date | null; doneBy: string | null }>,
  data: Awaited<ReturnType<typeof getDependents>>
): Promise<Array<ProjectPageItem | ProjectExternalItem>> {
  const out: Array<ProjectPageItem | ProjectExternalItem> = [];
  const pageConceptIds = items.filter((i) => i.pageConceptId).map((i) => i.pageConceptId as string);
  const externalEdgeIds = items.filter((i) => i.externalEdgeId).map((i) => i.externalEdgeId as string);

  const [pageRows, extRows] = await Promise.all([
    pageConceptIds.length
      ? db.pageConcept.findMany({
          where: { id: { in: pageConceptIds } },
          include: { page: { select: { slug: true, title: true, folderId: true, updatedAt: true } }, concept: true },
        })
      : Promise.resolve([]),
    externalEdgeIds.length
      ? db.externalEdge.findMany({
          where: { id: { in: externalEdgeIds } },
          include: { asset: true, concept: true },
        })
      : Promise.resolve([]),
  ]);

  const sourceUpdatedAt = data.asserters.reduce<Date | undefined>((m, a) => {
    const t = new Date(a.updatedAt);
    return !m || t > m ? t : m;
  }, undefined);

  const itemByPageConceptId = new Map(items.filter((i) => i.pageConceptId).map((i) => [i.pageConceptId as string, i]));
  const itemByExternalEdgeId = new Map(items.filter((i) => i.externalEdgeId).map((i) => [i.externalEdgeId as string, i]));

  for (const row of pageRows) {
    const item = itemByPageConceptId.get(row.id);
    if (!item) continue;
    const dependentRow = data.dependents.find((d) => d.slug === row.page.slug && d.via === row.concept.displayName);
    out.push({
      slug: row.page.slug,
      title: row.page.title,
      folderId: row.page.folderId,
      rel: row.rel,
      via: row.concept.displayName,
      trusted: dependentRow?.trusted ?? true,
      trustedBehind: dependentRow?.trustedBehind ?? false,
      updatedAt: row.page.updatedAt.toISOString(),
      verifiedAt: dependentRow?.verifiedAt ?? null,
      verifiedNote: dependentRow?.verifiedNote ?? null,
      needsChange: dependentRow?.needsChange ?? false,
      staleAgainstSource: dependentRow?.staleAgainstSource ?? false,
      itemId: item.id,
      dueDate: item.dueDate?.toISOString() ?? null,
      done: item.done,
      doneAt: item.doneAt?.toISOString() ?? null,
      doneBy: item.doneBy,
      doneStale: item.done && isStale(item.doneAt, sourceUpdatedAt),
    });
  }
  for (const row of extRows) {
    const item = itemByExternalEdgeId.get(row.id);
    if (!item) continue;
    const externalRow = data.external.find((e) => e.id === row.id);
    out.push({
      id: row.id,
      assetId: row.asset.id,
      url: row.asset.url,
      host: externalRow?.host ?? row.asset.url,
      label: item.owner ? row.asset.label : row.asset.label,
      owner: item.owner ?? row.asset.owner,
      rel: row.rel,
      via: row.concept.displayName,
      alsoDependsOn: externalRow?.alsoDependsOn ?? [],
      verifiedAt: externalRow?.verifiedAt ?? null,
      verifiedNote: externalRow?.verifiedNote ?? null,
      needsChange: externalRow?.needsChange ?? false,
      staleAgainstSource: externalRow?.staleAgainstSource ?? false,
      itemId: item.id,
      dueDate: item.dueDate?.toISOString() ?? null,
      done: item.done,
      doneAt: item.doneAt?.toISOString() ?? null,
      doneBy: item.doneBy,
      doneStale: item.done && isStale(item.doneAt, sourceUpdatedAt),
    });
  }
  return out;
}

export interface CreateProjectFromTemplateInput {
  /** New, unique term for this project. */
  term: string;
  title: string;
  /** Existing map term to clone. Its own depends/external snapshot into independent edges; its includes stay live-referenced. Omit to start blank. */
  templateTerm?: string;
  /** Page that owns the truth for this project, if different from the template's. */
  source?: string;
}

/**
 * Clone a map into a trackable project. The template's own depends/external
 * become brand-new PageConcept/ExternalEdge rows on the project's own term -
 * independent from the moment they're created, so editing the template
 * later never reaches back into this project. Its includes (shared
 * checklists like a docs-refresh or sales-enablement group) stay live
 * references: one place to fix, verified per project via the same
 * ConceptVerificationContext mechanism as an ordinary include.
 */
export async function createProjectFromTemplate(
  orgId: string,
  input: CreateProjectFromTemplateInput,
  createdBy: string
): Promise<ProjectResult> {
  const term = normalizeTerm(input.term);
  if (!term) throw new Error("term is required");
  if (!input.title?.trim()) throw new Error("title is required");

  const existingProject = await db.project.findUnique({ where: { orgId_term: { orgId, term } } });
  if (existingProject) throw new Error(`a project already exists for ${term}`);

  const concept = await ensureConcept(term, term, await findConceptForTerm(term, term));

  const project = await db.project.create({
    data: {
      orgId,
      term,
      title: input.title.trim(),
      clonedFrom: input.templateTerm ? normalizeTerm(input.templateTerm) : null,
      createdBy,
    },
  });

  if (input.source) {
    const page = await db.page.findUnique({ where: { orgId_slug: { orgId, slug: input.source } }, select: { id: true } });
    if (page) await upsertConcepts(page.id, [{ term, rel: "asserts" }], createdBy, { verified: false });
  }

  if (input.templateTerm) {
    const templateNorm = normalizeTerm(input.templateTerm);
    const template = await findConceptForTerm(input.templateTerm, templateNorm);
    if (!template) throw new Error(`template not found: ${templateNorm}`);
    const templateData = await getDependents(orgId, { term: templateNorm });

    // Own edges (no group tag): clone as independent edges + tracked items.
    for (const d of templateData.dependents.filter((d) => !d.group)) {
      const page = await db.page.findUnique({ where: { orgId_slug: { orgId, slug: d.slug } }, select: { id: true } });
      if (!page) continue;
      await upsertConcepts(page.id, [{ term, rel: "depends" as ConceptRel }], createdBy, { verified: false });
      const edge = await db.pageConcept.findFirst({ where: { pageId: page.id, conceptId: concept.id } });
      if (edge) {
        await db.projectItem.upsert({
          where: { projectId_pageConceptId: { projectId: project.id, pageConceptId: edge.id } },
          create: { projectId: project.id, kind: "page", pageConceptId: edge.id, createdBy },
          update: {},
        });
      }
    }
    for (const e of templateData.external.filter((e) => !e.group)) {
      const [row] = await upsertExternalDependents(orgId, term, [{ url: e.url, label: e.label, owner: e.owner ?? undefined, rel: "depends" as ConceptRel }], createdBy);
      if (row) {
        await db.projectItem.upsert({
          where: { projectId_externalEdgeId: { projectId: project.id, externalEdgeId: row.id } },
          create: { projectId: project.id, kind: "external", externalEdgeId: row.id, owner: e.owner ?? null, createdBy },
          update: {},
        });
      }
    }
    // Sub-maps: live reference, exactly like an ordinary include.
    for (const inc of templateData.includes) {
      await includeMap(orgId, term, inc.term, createdBy);
    }
  }

  return getProject(orgId, term);
}

export interface AddProjectItemInput {
  slug?: string;
  url?: string;
  label?: string;
  owner?: string;
  dueDate?: string;
}

/** Add one more page or external edge to a project's own tracked items, after creation. */
export async function addProjectItem(orgId: string, term: string, input: AddProjectItemInput, createdBy: string): Promise<void> {
  const project = await findProject(orgId, term);
  if (input.slug) {
    const page = await db.page.findUnique({ where: { orgId_slug: { orgId, slug: input.slug } }, select: { id: true } });
    if (!page) throw new Error(`page not found: ${input.slug}`);
    await upsertConcepts(page.id, [{ term: project.term, rel: "depends" }], createdBy, { verified: false });
    const edge = await db.pageConcept.findFirst({ where: { pageId: page.id, concept: { normalizedName: project.term } } });
    if (edge) {
      await db.projectItem.upsert({
        where: { projectId_pageConceptId: { projectId: project.id, pageConceptId: edge.id } },
        create: { projectId: project.id, kind: "page", pageConceptId: edge.id, owner: input.owner ?? null, dueDate: input.dueDate ? new Date(input.dueDate) : null, createdBy },
        update: { owner: input.owner ?? undefined, dueDate: input.dueDate ? new Date(input.dueDate) : undefined },
      });
    }
    return;
  }
  if (input.url) {
    const [row] = await upsertExternalDependents(orgId, project.term, [{ url: input.url, label: input.label, owner: input.owner, rel: "depends" }], createdBy);
    if (row) {
      await db.projectItem.upsert({
        where: { projectId_externalEdgeId: { projectId: project.id, externalEdgeId: row.id } },
        create: { projectId: project.id, kind: "external", externalEdgeId: row.id, owner: input.owner ?? null, dueDate: input.dueDate ? new Date(input.dueDate) : null, createdBy },
        update: { owner: input.owner ?? undefined, dueDate: input.dueDate ? new Date(input.dueDate) : undefined },
      });
    }
    return;
  }
  throw new Error("slug or url is required");
}

type ProjectItemRow = { id: string; pageConceptId: string | null; externalEdgeId: string | null };

/** Detach one item's underlying edge (never an included sub-map's - those belong to whichever context created the include, not to this project). */
async function detachItemEdge(orgId: string, projectTerm: string, item: ProjectItemRow): Promise<void> {
  if (item.pageConceptId) {
    const pc = await db.pageConcept.findUnique({ where: { id: item.pageConceptId }, select: { pageId: true } });
    if (pc) await upsertConcepts(pc.pageId, [{ term: projectTerm, remove: true }], "agent");
  }
  if (item.externalEdgeId) {
    const edge = await db.externalEdge.findUnique({ where: { id: item.externalEdgeId }, select: { asset: { select: { url: true } } } });
    if (edge) await upsertExternalDependents(orgId, projectTerm, [{ url: edge.asset.url, remove: true }], "agent");
  }
}

/** Detach an item from a project's own tracked set (and its underlying edge). Never touches an included sub-map's items. */
export async function removeProjectItem(orgId: string, term: string, itemId: string): Promise<void> {
  const project = await findProject(orgId, term);
  const item = await db.projectItem.findFirst({ where: { id: itemId, projectId: project.id } });
  if (!item) return;
  await detachItemEdge(orgId, project.term, item);
  await db.projectItem.deleteMany({ where: { id: itemId, projectId: project.id } });
}

export interface UpdateProjectItemInput {
  itemId: string;
  done?: boolean;
  owner?: string;
  dueDate?: string | null;
}

/**
 * Mark a project item done/open, or change its owner/due date. done is a
 * distinct claim from verified: it says the update shipped, not that the
 * source hasn't moved since. Setting done records who and when; the
 * project's live view keeps computing doneStale against the current source.
 */
export async function updateProjectItem(orgId: string, term: string, input: UpdateProjectItemInput, actorId: string): Promise<void> {
  const project = await findProject(orgId, term);
  const item = await db.projectItem.findFirst({ where: { id: input.itemId, projectId: project.id } });
  if (!item) throw new Error(`item not found on project ${project.term}: ${input.itemId}`);
  const data: { done?: boolean; doneAt?: Date | null; doneBy?: string | null; owner?: string | null; dueDate?: Date | null } = {};
  if (input.done !== undefined) {
    data.done = input.done;
    data.doneAt = input.done ? new Date() : null;
    data.doneBy = input.done ? actorId : null;
  }
  if (input.owner !== undefined) data.owner = input.owner || null;
  if (input.dueDate !== undefined) data.dueDate = input.dueDate ? new Date(input.dueDate) : null;
  await db.projectItem.update({ where: { id: item.id }, data });
}

/**
 * Remove an entire project: detaches every one of its own cloned edges
 * first (otherwise a deleted project leaves dangling depends rows tagged
 * to a term nothing points at any more), then the project row, cascading
 * its ProjectItem rows. Never touches an included sub-map's edges - those
 * belong to the group, not to this project.
 */
export async function deleteProject(orgId: string, term: string): Promise<void> {
  const project = await db.project.findUnique({ where: { orgId_term: { orgId, term: normalizeTerm(term) } } });
  if (!project) return;
  const items = await db.projectItem.findMany({ where: { projectId: project.id } });
  for (const item of items) await detachItemEdge(orgId, project.term, item);
  await db.project.delete({ where: { id: project.id } });
}
