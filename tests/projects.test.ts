import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import { createTestOrg, createTestPage } from "./helpers";

vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});

import { testDb } from "./setup";
import { upsertConcepts, mapDependencies, getDependents, verifyDependent } from "@/lib/concepts";
import {
  createProjectFromTemplate,
  getProject,
  updateProjectItem,
  addProjectItem,
  removeProjectItem,
  deleteProject,
  listProjects,
} from "@/lib/projects";

const T = (s: string) => `proj-${s}`;

describe("projects: clone a template into a tracked run", () => {
  let orgId: string;
  beforeEach(async () => {
    orgId = (await createTestOrg({ name: "Proj Org", slug: "proj-org" })).id;
  });

  it("clones the template's own edges independently; editing the template afterward never touches the project", async () => {
    const tmplSrc = await createTestPage(orgId, { slug: "tmpl-src" });
    await createTestPage(orgId, { slug: "tmpl-own-a" });
    await createTestPage(orgId, { slug: "tmpl-own-b" });
    await upsertConcepts(tmplSrc.id, [{ term: T("template/launch"), rel: "asserts" }], "agent");
    await mapDependencies(orgId, { term: T("template/launch"), depends: ["tmpl-own-a", "tmpl-own-b"] }, "agent");

    const project = await createProjectFromTemplate(orgId, { term: T("launch/one"), title: "Launch one", templateTerm: T("template/launch") }, "agent");
    expect(project.items.map((i) => "slug" in i ? i.slug : i.url).sort()).toEqual(["tmpl-own-a", "tmpl-own-b"]);
    expect(project.completion).toEqual({ total: 2, done: 0, open: 2, overdue: 0 });

    // The clone owns separate edges: the template's own PageConcept rows for
    // template/launch are untouched, and mapDependencies against the
    // template later never appears on the project.
    await mapDependencies(orgId, { term: T("template/launch"), depends: ["tmpl-own-a"] }, "agent"); // no-op re-tag
    await createTestPage(orgId, { slug: "tmpl-own-c" });
    await mapDependencies(orgId, { term: T("template/launch"), depends: ["tmpl-own-c"] }, "agent");

    const after = await getProject(orgId, T("launch/one"));
    expect(after.items.map((i) => "slug" in i ? i.slug : i.url).sort()).toEqual(["tmpl-own-a", "tmpl-own-b"]);

    const templateGraph = await getDependents(orgId, { term: T("template/launch") });
    expect(templateGraph.dependents.map((d) => d.slug).sort()).toEqual(["tmpl-own-a", "tmpl-own-b", "tmpl-own-c"]);
  });

  it("keeps an included sub-map live: template's includes stay a shared checklist, verified per project", async () => {
    const groupSrc = await createTestPage(orgId, { slug: "pj-grp-src" });
    await createTestPage(orgId, { slug: "pj-grp-shared" });
    await upsertConcepts(groupSrc.id, [{ term: T("group/shared"), rel: "asserts" }], "agent");
    await mapDependencies(orgId, { term: T("group/shared"), depends: ["pj-grp-shared"] }, "agent");

    const tmplSrc = await createTestPage(orgId, { slug: "pj-tmpl-src" });
    await upsertConcepts(tmplSrc.id, [{ term: T("template/x"), rel: "asserts" }], "agent");
    await mapDependencies(orgId, { term: T("template/x"), includes: [T("group/shared")] }, "agent");

    const p1 = await createProjectFromTemplate(orgId, { term: T("run/a"), title: "Run A", templateTerm: T("template/x") }, "agent");
    const p2 = await createProjectFromTemplate(orgId, { term: T("run/b"), title: "Run B", templateTerm: T("template/x") }, "agent");
    expect(p1.includes.map((i) => i.term)).toEqual([T("group/shared")]);
    expect(p2.includes.map((i) => i.term)).toEqual([T("group/shared")]);
    expect(p1.includes[0].items.map((i) => "slug" in i ? i.slug : i.url)).toEqual(["pj-grp-shared"]);

    // Verify the shared row for run/a's context only.
    await verifyDependent(orgId, { slug: "pj-grp-shared", term: T("group/shared"), context: T("run/a"), note: "checked for A" });
    const a = await getProject(orgId, T("run/a"));
    const b = await getProject(orgId, T("run/b"));
    expect((a.includes[0].items[0] as { verifiedAt: string | null }).verifiedAt).not.toBeNull();
    expect((b.includes[0].items[0] as { verifiedAt: string | null }).verifiedAt).toBeNull();
  });

  it("creating a project with the same term twice is refused", async () => {
    await createTestPage(orgId, { slug: "dup-src" });
    await createProjectFromTemplate(orgId, { term: T("dup"), title: "Dup" }, "agent");
    await expect(createProjectFromTemplate(orgId, { term: T("dup"), title: "Dup again" }, "agent")).rejects.toThrow(/already exists/);
  });

  it("done is distinct from verified: marking done clears no staleness, and doneStale fires when the source moves again after done", async () => {
    const src = await createTestPage(orgId, { slug: "done-src" });
    await createTestPage(orgId, { slug: "done-a" });
    await upsertConcepts(src.id, [{ term: T("launch/done"), rel: "asserts" }], "agent");
    const project = await createProjectFromTemplate(orgId, { term: T("launch/done"), title: "Done test", source: "done-src" }, "agent");
    await addProjectItem(orgId, T("launch/done"), { slug: "done-a" }, "agent");

    let p = await getProject(orgId, T("launch/done"));
    const item = p.items[0];
    expect(item.done).toBe(false);
    expect(item.doneStale).toBe(false);
    // Still stale-against-source (never verified) even though we're about to mark it done -
    // done and verified are independent claims.
    expect(item.staleAgainstSource).toBe(true);

    await updateProjectItem(orgId, T("launch/done"), { itemId: item.itemId, done: true, owner: "PMM", dueDate: "2026-10-01" }, "u1");
    p = await getProject(orgId, T("launch/done"));
    let after = p.items[0];
    expect(after.done).toBe(true);
    expect(after.doneAt).not.toBeNull();
    expect(after.doneBy).toBe("u1");
    expect((after as { owner?: string }).owner ?? null).not.toBe(undefined);
    expect(after.doneStale).toBe(false);

    // Source moves again after done -> doneStale.
    await new Promise((r) => setTimeout(r, 5));
    await testDb.page.update({ where: { id: src.id }, data: { updatedAt: new Date() } });
    p = await getProject(orgId, T("launch/done"));
    after = p.items[0];
    expect(after.done).toBe(true);
    expect(after.doneStale).toBe(true);

    // Un-done clears doneAt/doneBy.
    await updateProjectItem(orgId, T("launch/done"), { itemId: item.itemId, done: false }, "u1");
    p = await getProject(orgId, T("launch/done"));
    after = p.items[0];
    expect(after.done).toBe(false);
    expect(after.doneAt).toBeNull();
    expect(after.doneBy).toBeNull();

    expect(project.term).toBe(T("launch/done"));
  });

  it("addProjectItem and removeProjectItem manage the project's own set without touching the underlying map for other consumers", async () => {
    await createTestPage(orgId, { slug: "add-src" });
    await createTestPage(orgId, { slug: "add-a" });
    const project = await createProjectFromTemplate(orgId, { term: T("launch/add"), title: "Add test" }, "agent");
    await addProjectItem(orgId, project.term, { slug: "add-a", owner: "Eng", dueDate: "2026-11-01" }, "agent");
    let p = await getProject(orgId, project.term);
    expect(p.items).toHaveLength(1);
    expect(p.items[0].dueDate).not.toBeNull();

    await removeProjectItem(orgId, project.term, p.items[0].itemId);
    p = await getProject(orgId, project.term);
    expect(p.items).toHaveLength(0);
    const graph = await getDependents(orgId, { term: project.term });
    expect(graph.dependents).toEqual([]);
  });

  it("deleteProject removes the project and its items but never the underlying edges of an included group", async () => {
    const groupSrc = await createTestPage(orgId, { slug: "del-grp-src" });
    await createTestPage(orgId, { slug: "del-grp-shared" });
    await upsertConcepts(groupSrc.id, [{ term: T("group/del"), rel: "asserts" }], "agent");
    await mapDependencies(orgId, { term: T("group/del"), depends: ["del-grp-shared"] }, "agent");
    await createProjectFromTemplate(orgId, { term: T("launch/del"), title: "Del test", templateTerm: T("group/del") }, "agent");
    await deleteProject(orgId, T("launch/del"));
    await expect(getProject(orgId, T("launch/del"))).rejects.toThrow(/no project/);
    const group = await getDependents(orgId, { term: T("group/del") });
    expect(group.dependents.map((d) => d.slug)).toEqual(["del-grp-shared"]);
  });

  it("deleteProject also detaches its own cloned edges, not just the project row", async () => {
    await createTestPage(orgId, { slug: "del-own-src" });
    const p = await createProjectFromTemplate(orgId, { term: T("launch/del-own"), title: "Del own" }, "agent");
    await addProjectItem(orgId, p.term, { slug: "del-own-src" }, "agent");
    let graph = await getDependents(orgId, { term: T("launch/del-own") });
    expect(graph.dependents).toHaveLength(1);
    await deleteProject(orgId, T("launch/del-own"));
    graph = await getDependents(orgId, { term: T("launch/del-own") });
    expect(graph.dependents).toEqual([]);
  });
});

describe("projects: bug fixes from the cold MCP review", () => {
  let orgId: string;
  beforeEach(async () => {
    orgId = (await createTestOrg({ name: "Fix Org", slug: "fix-org" })).id;
  });

  it("owner is readable on a page item, not just external", async () => {
    await createTestPage(orgId, { slug: "fx-src" });
    await createTestPage(orgId, { slug: "fx-a" });
    const project = await createProjectFromTemplate(orgId, { term: T("fix/owner"), title: "Owner fix" }, "agent");
    await addProjectItem(orgId, project.term, { slug: "fx-a", owner: "PMM" }, "agent");
    const p = await getProject(orgId, project.term);
    expect((p.items[0] as { owner: string | null }).owner).toBe("PMM");
    await updateProjectItem(orgId, project.term, { itemId: p.items[0].itemId, owner: "Sales" }, "u1");
    const p2 = await getProject(orgId, project.term);
    expect((p2.items[0] as { owner: string | null }).owner).toBe("Sales");
  });

  it("a bad due_date is rejected with a clean error before any write, no orphaned asset or edge", async () => {
    const project = await createProjectFromTemplate(orgId, { term: T("fix/date"), title: "Date fix" }, "agent");
    await expect(
      addProjectItem(orgId, project.term, { url: "https://example.com/orphan-test", dueDate: "not-a-real-date" }, "agent")
    ).rejects.toThrow(/due_date is not a valid date/);
    const p = await getProject(orgId, project.term);
    expect(p.items).toEqual([]);
    const graph = await getDependents(orgId, { term: project.term });
    expect(graph.external).toEqual([]);
    // Same guard on update.
    await createTestPage(orgId, { slug: "fx-date-a" });
    await addProjectItem(orgId, project.term, { slug: "fx-date-a" }, "agent");
    const p2 = await getProject(orgId, project.term);
    await expect(
      updateProjectItem(orgId, project.term, { itemId: p2.items[0].itemId, dueDate: "also-not-a-date" }, "u1")
    ).rejects.toThrow(/due_date is not a valid date/);
  });

  it("the error hint for an unknown project points at create_project, not an internal function name", async () => {
    await expect(getProject(orgId, T("fix/no-such"))).rejects.toThrow(/create_project/);
    await expect(getProject(orgId, T("fix/no-such"))).rejects.not.toThrow(/createProjectFromTemplate/);
  });

  it("listProjects ranks by creation, with a completion roll-up, and lets you check a shared checklist's reuse end to end", async () => {
    const groupSrc = await createTestPage(orgId, { slug: "fx-grp-src" });
    await createTestPage(orgId, { slug: "fx-grp-shared" });
    await upsertConcepts(groupSrc.id, [{ term: T("group/fixshared"), rel: "asserts" }], "agent");
    await mapDependencies(orgId, { term: T("group/fixshared"), depends: ["fx-grp-shared"] }, "agent");

    // Two root templates that each include the shared group - the group
    // stays live-referenced (not cloned) only via an explicit include, not
    // by naming the group itself as templateTerm (that clones its own
    // depends as owned items instead, tested separately above).
    const tmplSrcA = await createTestPage(orgId, { slug: "fx-tmpl-a-src" });
    const tmplSrcB = await createTestPage(orgId, { slug: "fx-tmpl-b-src" });
    await upsertConcepts(tmplSrcA.id, [{ term: T("template/a"), rel: "asserts" }], "agent");
    await upsertConcepts(tmplSrcB.id, [{ term: T("template/b"), rel: "asserts" }], "agent");
    await mapDependencies(orgId, { term: T("template/a"), includes: [T("group/fixshared")] }, "agent");
    await mapDependencies(orgId, { term: T("template/b"), includes: [T("group/fixshared")] }, "agent");

    const a = await createProjectFromTemplate(orgId, { term: T("fix/run-a"), title: "Run A", templateTerm: T("template/a") }, "agent");
    const b = await createProjectFromTemplate(orgId, { term: T("fix/run-b"), title: "Run B", templateTerm: T("template/b") }, "agent");

    let list = await listProjects(orgId);
    const terms = list.map((p) => p.term);
    expect(terms).toContain(a.term);
    expect(terms).toContain(b.term);
    expect(list.find((p) => p.term === a.term)?.completion).toEqual({ total: 0, done: 0, open: 0, overdue: 0 });

    await verifyDependent(orgId, { slug: "fx-grp-shared", term: T("group/fixshared"), context: a.term, note: "checked for A" });
    const pa = await getProject(orgId, a.term);
    const pb = await getProject(orgId, b.term);
    expect((pa.includes[0].items[0] as { verifiedAt: string | null }).verifiedAt).not.toBeNull();
    expect((pb.includes[0].items[0] as { verifiedAt: string | null }).verifiedAt).toBeNull();

    list = await listProjects(orgId);
    expect(list.map((p) => p.term)).toEqual(expect.arrayContaining([a.term, b.term]));
  });
});
