import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { createTestOrg, createTestPage } from "./helpers";

vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});
const resolveOrgMock = vi.fn();
vi.mock("@/lib/auth", () => ({ resolveOrg: () => resolveOrgMock() }));

import { GET, POST, DELETE } from "@/app/api/projects/route";
import { POST as itemsPost, PATCH as itemsPatch, DELETE as itemsDelete } from "@/app/api/projects/items/route";
import { upsertConcepts, mapDependencies } from "@/lib/concepts";

function req(method: string, url: string, body?: Record<string, unknown>): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

describe("/api/projects", () => {
  it("creates, reads, and deletes a project; enforces org scope and role", async () => {
    const org = await createTestOrg({ name: "PR Org", slug: "pr-org" });
    const other = await createTestOrg({ name: "PR Other", slug: "pr-other" });
    resolveOrgMock.mockResolvedValue({ orgId: org.id, userId: "u1", role: "owner" });

    const tmplSrc = await createTestPage(org.id, { slug: "pr-tmpl-src" });
    await createTestPage(org.id, { slug: "pr-own-a" });
    await upsertConcepts(tmplSrc.id, [{ term: "pr-template", rel: "asserts" }], "agent");
    await mapDependencies(org.id, { term: "pr-template", depends: ["pr-own-a"] }, "agent");

    const create = await POST(req("POST", "http://localhost/api/projects", { term: "pr-launch", title: "PR Launch", templateTerm: "pr-template" }));
    expect(create.status).toBe(200);
    const created = await create.json();
    expect(created.items.map((i: { slug: string }) => i.slug)).toEqual(["pr-own-a"]);

    const get = await GET(req("GET", "http://localhost/api/projects?term=pr-launch"));
    expect(get.status).toBe(200);
    expect((await get.json()).title).toBe("PR Launch");

    // Cross-org: same term, different org, sees nothing.
    resolveOrgMock.mockResolvedValue({ orgId: other.id, userId: "u2", role: "owner" });
    const crossGet = await GET(req("GET", "http://localhost/api/projects?term=pr-launch"));
    expect(crossGet.status).toBe(404);

    // Viewer role cannot create.
    resolveOrgMock.mockResolvedValue({ orgId: org.id, userId: "u3", role: "viewer" });
    const forbidden = await POST(req("POST", "http://localhost/api/projects", { term: "pr-launch-2", title: "X" }));
    expect(forbidden.status).toBe(403);

    resolveOrgMock.mockResolvedValue({ orgId: org.id, userId: "u1", role: "owner" });
    const del = await DELETE(req("DELETE", "http://localhost/api/projects", { term: "pr-launch" }));
    expect(del.status).toBe(200);
    expect((await GET(req("GET", "http://localhost/api/projects?term=pr-launch"))).status).toBe(404);
  });
});

describe("/api/projects/items", () => {
  it("adds, updates (done + owner + dueDate), and removes an item", async () => {
    const org = await createTestOrg({ name: "PRI Org", slug: "pri-org" });
    resolveOrgMock.mockResolvedValue({ orgId: org.id, userId: "u1", role: "owner" });
    await createTestPage(org.id, { slug: "pri-src" });
    await createTestPage(org.id, { slug: "pri-a" });
    await POST(req("POST", "http://localhost/api/projects", { term: "pri-launch", title: "PRI Launch" }));

    const add = await itemsPost(req("POST", "http://localhost/api/projects/items", { term: "pri-launch", slug: "pri-a", owner: "Eng", dueDate: "2026-12-01" }));
    expect(add.status).toBe(200);
    const afterAdd = await add.json();
    expect(afterAdd.items).toHaveLength(1);
    const itemId = afterAdd.items[0].itemId;

    const patch = await itemsPatch(req("PATCH", "http://localhost/api/projects/items", { term: "pri-launch", itemId, done: true }));
    expect(patch.status).toBe(200);
    const afterPatch = await patch.json();
    expect(afterPatch.items[0].done).toBe(true);
    expect(afterPatch.completion).toEqual({ total: 1, done: 1, open: 0, overdue: 0 });

    const del = await itemsDelete(req("DELETE", "http://localhost/api/projects/items", { term: "pri-launch", itemId }));
    expect(del.status).toBe(200);
    expect((await del.json()).items).toHaveLength(0);
  });
});
