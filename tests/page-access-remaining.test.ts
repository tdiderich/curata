import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { testDb } from "./setup";
import { createTestOrg, createTestPage, createTestApiKey } from "./helpers";

vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});

// Page-level access only applies outside AUTH_MODE=none.
const resolveOrgMock = vi.fn();
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  AUTH_MODE: "oauth",
  resolveOrg: () => resolveOrgMock(),
}));

vi.mock("@/lib/kazam", async (importOriginal) => {
  const os = await import("os");
  const path = await import("path");
  const tmpDir = path.join(os.tmpdir(), `curata-test-page-access-rest-${process.pid}`);
  return {
    ...(await importOriginal<typeof import("@/lib/kazam")>()),
    sitePath: () => tmpDir,
    buildSite: vi.fn().mockResolvedValue(""),
    validateContent: vi.fn().mockResolvedValue([]),
    validateContentSplit: vi.fn().mockResolvedValue({ errors: [], warnings: [] }),
    checkUnsupportedComponents: vi.fn().mockReturnValue([]),
  };
});

import { POST as tagsPOST, DELETE as tagsDELETE } from "@/app/api/tags/route";
import { GET as flagsGET, PATCH as flagsPATCH } from "@/app/api/flags/route";
import { GET as qaGET, POST as qaPOST } from "@/app/api/quick-actions/route";
import { GET as chartGET, POST as chartPOST } from "@/app/api/chart/route";
import { GET as scopeGET, POST as scopePOST } from "@/app/api/chart/scope/route";
import { GET as impactGET } from "@/app/api/chart/impact/route";
import { POST as depMapPOST } from "@/app/api/dependents/map/route";
import { POST as depVerifyPOST } from "@/app/api/dependents/verify/route";
import { PATCH as pagesPATCH, DELETE as pagesDELETE } from "@/app/api/pages/route";
import { DELETE as foldersDELETE, PATCH as foldersPATCH } from "@/app/api/folders/route";
import { DELETE as qaDELETE } from "@/app/api/quick-actions/route";
import { POST as bulkPOST } from "@/app/api/pages/bulk/route";
import { POST as mcpPOST } from "@/app/api/mcp/route";
import { mcpPageDenial } from "@/lib/mcp-page-access";
import { dispatch } from "@/lib/mcp-dispatch";
import { getChart, getChartNode, getNeedsLook, promotePageToNode, setChartNode } from "@/lib/chart";
import { addScopeItem } from "@/lib/scope";
import { upsertConcepts } from "@/lib/concepts";

let orgId: string;

async function page(slug: string, createdBy: string, visibility: string, extra: Record<string, unknown> = {}) {
  return createTestPage(orgId, { slug, title: slug.toUpperCase(), createdBy, visibility, ...extra });
}

async function share(pageId: string, userId: string, role: "viewer" | "editor") {
  await testDb.pageShare.create({ data: { pageId, userId, role, invitedBy: "bob" } });
}

function as(userId: string, role = "admin") {
  resolveOrgMock.mockResolvedValue({ orgId, orgSlug: "rest-org", userId, role });
}

const req = (method: string, path: string, body?: unknown) =>
  new NextRequest(`http://localhost${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

beforeEach(async () => {
  orgId = (await createTestOrg({ slug: "rest-org" })).id;
});

describe("content chart hides private pages", () => {
  beforeEach(async () => {
    const src = await page("src", "alice", "org");
    await upsertConcepts(src.id, [{ term: "topic-x", rel: "asserts" }], "alice");
    for (const slug of ["c1", "c2"]) {
      const p = await page(slug, "alice", "org");
      await upsertConcepts(p.id, [{ term: "topic-x", rel: "depends" }], "alice");
    }
    const priv = await page("priv", "bob", "private");
    await upsertConcepts(priv.id, [{ term: "topic-x", rel: "depends" }], "bob");
    await page("bob-src", "bob", "private");
    await promotePageToNode(orgId, "bob-src", "bob", "bob");
  });

  it("children, counts and promoted nodes only show what the caller can open", async () => {
    const node = await getChartNode(orgId, "topic-x", "alice");
    expect(node.children.map((c) => c.slug).sort()).toEqual(["c1", "c2"]);
    expect((await getChartNode(orgId, "topic-x", "bob")).children.map((c) => c.slug)).toContain("priv");

    const chart = await getChart(orgId, { includeHidden: true, userId: "alice" });
    expect(chart.nodes.map((n) => n.term)).not.toContain("bob-src");
    // Fan-out counts only visible children: 2 for alice (below the 3 that
    // makes a node), 3 for bob.
    expect(chart.nodes.find((n) => n.term === "topic-x")).toBeUndefined();
    expect((await getChart(orgId, { userId: "bob" })).nodes.find((n) => n.term === "topic-x")?.fanOut).toBe(3);
    await expect(getChartNode(orgId, "bob-src", "alice")).rejects.toThrow(/concept not found/);
    expect((await getChartNode(orgId, "bob-src", "bob")).source?.slug).toBe("bob-src");
    expect(JSON.stringify(await getNeedsLook(orgId, "alice"))).not.toMatch(/priv|bob-src/);
  });

  it("chart routes, page suggestions and impact answer for visible pages only", async () => {
    as("alice");
    const body = JSON.stringify(await (await chartGET(req("GET", "/api/chart?term=topic-x"))).json());
    expect(body).toContain("c1");
    expect(body).not.toContain("priv");
    expect((await chartGET(req("GET", "/api/chart?term=bob-src"))).status).toBe(404);

    // Body mentions topic x but isn't under the node: suggested to bob only.
    await page("mentions", "bob", "private", { yamlContent: "title: M\nshell: document\ncomponents:\n  - type: markdown\n    body: all about topic x\n" });
    const sugg = await (await scopeGET(req("GET", "/api/chart/scope?term=topic-x&kind=pages"))).json();
    expect(JSON.stringify(sugg)).not.toContain("mentions");

    expect(await (await impactGET(req("GET", "/api/chart/impact?slug=bob-src"))).json()).toEqual({ nodes: [], pages: 0, external: 0, text: null });
  });

  it("chart writes treat a hidden page as missing and a viewer share as view-only", async () => {
    as("alice");
    const hidden = await scopePOST(req("POST", "/api/chart/scope", { term: "topic-x", slug: "priv" }));
    const missing = await scopePOST(req("POST", "/api/chart/scope", { term: "topic-x", slug: "nope" }));
    expect(hidden.status).toBe(404);
    expect((await hidden.json()).error).toBe((await missing.json()).error.replace("nope", "priv"));
    expect((await chartPOST(req("POST", "/api/chart", { slug: "bob-src" }))).status).toBe(404);

    const priv = await testDb.page.findUniqueOrThrow({ where: { orgId_slug: { orgId, slug: "priv" } } });
    await share(priv.id, "alice", "viewer");
    expect((await chartPOST(req("POST", "/api/chart", { slug: "priv" }))).status).toBe(403);
    expect((await depMapPOST(req("POST", "/api/dependents/map", { term: "topic-x", depends: ["c1", "priv"] }))).status).toBe(403);
    // Nothing half-applied: c1 kept its single edge.
    expect(await testDb.pageConcept.count({ where: { page: { slug: "c1", orgId } } })).toBe(1);
  });

  it("a term only on a hidden page, or only in another org, is unknown before any write", async () => {
    const lone = await page("lone", "bob", "private");
    await upsertConcepts(lone.id, [{ term: "bob-only-term", rel: "depends" }], "bob");
    const otherOrg = await createTestOrg({ slug: "rest-other" });
    const foreign = await createTestPage(otherOrg.id, { slug: "foreign", visibility: "org" });
    await upsertConcepts(foreign.id, [{ term: "foreign-term", rel: "depends" }], "x");

    for (const term of ["bob-only-term", "foreign-term"]) {
      const msg = (t: string) => `concept not found: ${t}. get_chart lists every node.`;
      await expect(getChartNode(orgId, term, "alice")).rejects.toThrow(msg(term));
      await expect(setChartNode(orgId, term, { hidden: true }, "alice")).rejects.toThrow(msg(term));
      await expect(setChartNode(orgId, "never-used", { hidden: true }, "alice")).rejects.toThrow(msg("never-used"));
      const add = (t: string) => addScopeItem(orgId, t, { slug: "c1" }, "alice", "alice").catch((e: Error) => e.message.replaceAll(t, "X"));
      expect(await add(term)).toBe(await add("never-used"));
    }
    expect(await testDb.chartNodeSetting.count({ where: { orgId, concept: { normalizedName: { in: ["bob-only-term", "foreign-term", "never-used"] } } } })).toBe(0);
    expect(await testDb.pageConcept.count({ where: { page: { slug: "c1", orgId } } })).toBe(1);
    // Bob still has his own node.
    expect((await getChartNode(orgId, "bob-only-term", "bob")).term).toBe("bob-only-term");
  });

  it("promoting an archived page still works", async () => {
    await page("old", "alice", "org", { status: "archived" });
    expect((await promotePageToNode(orgId, "old", "alice", "alice")).term).toBe("old");
  });

  it("re-pointing a source leaves pages the caller can't edit alone", async () => {
    const priv = await page("priv-src", "bob", "private");
    await upsertConcepts(priv.id, [{ term: "topic-x", rel: "asserts" }], "bob");
    await setChartNode(orgId, "topic-x", { sourceSlug: "c1" }, "alice");
    expect(await testDb.pageConcept.count({ where: { pageId: priv.id, rel: "asserts" } })).toBe(1);
  });

  it("dependency map and verify answer a hidden slug like a missing one", async () => {
    as("alice");
    const map = async (slug: string) => JSON.stringify(await (await depMapPOST(req("POST", "/api/dependents/map", { term: "topic-y", depends: [slug] }))).json()).replaceAll(slug, "X");
    expect(await map("priv")).toBe(await map("nope"));
    const verify = async (slug: string) => {
      const res = await depVerifyPOST(req("POST", "/api/dependents/verify", { slug }));
      return [res.status, JSON.stringify(await res.json()).replaceAll(slug, "X")];
    };
    expect(await verify("priv")).toEqual(await verify("nope"));
  });
});

describe("tags, flags and quick actions", () => {
  it("tagging: hidden page is 404, viewer share is 403, editor share works", async () => {
    const priv = await page("priv", "bob", "private");
    as("alice");
    expect((await tagsPOST(req("POST", "/api/tags", { pageId: priv.id, tags: ["x"] }))).status).toBe(404);
    expect((await tagsDELETE(req("DELETE", "/api/tags", { pageId: priv.id, tag: "x" }))).status).toBe(404);
    await share(priv.id, "alice", "viewer");
    expect((await tagsPOST(req("POST", "/api/tags", { pageId: priv.id, tags: ["x"] }))).status).toBe(403);
    await testDb.pageShare.updateMany({ where: { pageId: priv.id }, data: { role: "editor" } });
    expect((await tagsPOST(req("POST", "/api/tags", { pageId: priv.id, tags: ["x"] }))).status).toBe(200);
  });

  it("flags: hidden pages leave the queue; delete is owner-only on a private page", async () => {
    const priv = await page("priv", "bob", "private");
    const pub = await page("pub", "bob", "org");
    const flag = (pageId: string) => testDb.pageFlag.create({ data: { pageId, action: "archive", reason: "stale", evidence: "e", actorId: "agent" } });
    const privFlag = await flag(priv.id);
    await flag(pub.id);

    as("alice");
    const queue = await (await flagsGET()).json();
    expect(queue.flags.map((f: { slug: string }) => f.slug)).toEqual(["pub"]);
    expect((await flagsPATCH(req("PATCH", "/api/flags", { flagId: privFlag.id, disposition: "keep" }))).status).toBe(404);

    await share(priv.id, "alice", "editor");
    expect((await flagsPATCH(req("PATCH", "/api/flags", { flagId: privFlag.id, disposition: "delete" }))).status).toBe(403);
    expect(await testDb.page.count({ where: { id: priv.id } })).toBe(1);
    expect((await flagsPATCH(req("PATCH", "/api/flags", { flagId: privFlag.id, disposition: "snooze" }))).status).toBe(200);

    as("bob");
    const bobFlag = await flag(priv.id);
    expect((await flagsPATCH(req("PATCH", "/api/flags", { flagId: bobFlag.id, disposition: "delete" }))).status).toBe(200);
  });

  it("quick actions: hidden skill pages can't be added and don't show in the list", async () => {
    const skills = await testDb.folder.create({ data: { orgId, name: "Skills", createdBy: "system" } });
    await testDb.folder.create({ data: { orgId, name: "Quick Actions", locked: true, createdBy: "system", rules: [{ id: "quick-refs", refs: ["bob-skill", "gone"] }] } });
    await page("bob-skill", "bob", "private", { folderId: skills.id });
    await page("org-skill", "bob", "org", { folderId: skills.id });

    as("alice");
    expect((await (await qaGET()).json()).refs).toEqual(["gone"]);
    const hidden = await qaPOST(req("POST", "/api/quick-actions", { slug: "bob-skill" }));
    expect(hidden.status).toBe(404);
    const added = await qaPOST(req("POST", "/api/quick-actions", { slug: "org-skill" }));
    expect((await added.json()).refs).toEqual(["gone", "org-skill"]);

    // Removing a hidden ref answers as if it weren't there and changes nothing.
    expect((await (await qaDELETE(req("DELETE", "/api/quick-actions", { slug: "bob-skill" }))).json()).refs).toEqual(["gone", "org-skill"]);

    as("bob");
    expect((await (await qaGET()).json()).refs).toEqual(["bob-skill", "gone", "org-skill"]);
  });
});

describe("folder delete", () => {
  it("won't cascade over someone else's private page", async () => {
    const folder = await testDb.folder.create({ data: { orgId, name: "Shared", visibility: "org", createdBy: "alice" } });
    const priv = await page("in-folder", "bob", "private", { folderId: folder.id });
    as("alice", "admin");
    const res = await foldersDELETE(req("DELETE", "/api/folders", { id: folder.id }));
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).not.toContain("in-folder");
    expect(await testDb.page.count({ where: { id: priv.id } })).toBe(1);

    await testDb.page.update({ where: { id: priv.id }, data: { createdBy: "alice" } });
    expect((await foldersDELETE(req("DELETE", "/api/folders", { id: folder.id }))).status).toBe(200);
  });
});

describe("folder visibility change", () => {
  it("names only the blocking pages the caller can see", async () => {
    const folder = await testDb.folder.create({ data: { orgId, name: "Mine", visibility: "private", createdBy: "alice" } });
    await page("bob-secret", "bob", "private", { folderId: folder.id });
    as("alice", "member");
    const res = await foldersPATCH(req("PATCH", "/api/folders", { id: folder.id, visibility: "org" }));
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error).not.toContain("bob-secret");
    expect(error).not.toMatch(/\d+ page/);
    await page("alice-draft", "alice", "private", { folderId: folder.id });
    const both = (await (await foldersPATCH(req("PATCH", "/api/folders", { id: folder.id, visibility: "org" }))).json()).error;
    expect(both).toContain("1 page(s) have lower visibility: alice-draft");
    expect(both).not.toContain("bob-secret");
  });
});

describe("folder updates: web and MCP share one check", () => {
  async function folders() {
    const bobs = await testDb.folder.create({ data: { orgId, name: "Bob private", visibility: "private", createdBy: "bob" } });
    const shared = await testDb.folder.create({ data: { orgId, name: "Team", visibility: "org", createdBy: "bob" } });
    const stock = await testDb.folder.create({ data: { orgId, name: "Skills", visibility: "org", createdBy: "system", locked: true } });
    const other = await createTestOrg({ slug: "rest-folder-other" });
    const foreign = await testDb.folder.create({ data: { orgId: other.id, name: "Elsewhere", visibility: "org", createdBy: "x" } });
    await testDb.orgMember.create({ data: { orgId, userId: "boss", role: "admin" } });
    return { bobs, shared, stock, foreign };
  }
  const mcp = (args: Record<string, string>, userId: string) =>
    dispatch("update_folder", args, orgId, "rest-org", userId, userId).then(() => "ok", (e: Error) => e.message);

  it("MCP update_folder: hidden, locked, visibility, rules and parent", async () => {
    const { bobs, shared, stock, foreign } = await folders();
    // Someone else's private folder reads as missing, for members and admins.
    expect(await mcp({ id: bobs.id, name: "pwned" }, "alice")).toBe(`folder not found: ${bobs.id}`);
    expect(await mcp({ id: "nope", name: "x" }, "alice")).toBe("folder not found: nope");
    expect(await mcp({ id: bobs.id, name: "pwned" }, "boss")).toBe(`folder not found: ${bobs.id}`);
    expect(await mcp({ id: stock.id, name: "x" }, "boss")).toBe("stock folders cannot be modified");
    expect(await mcp({ id: shared.id, visibility: "private" }, "alice")).toMatch(/only owner\/admin or creator/);
    expect(await mcp({ id: shared.id, rules: "[]" }, "alice")).toMatch(/only owner\/admin can set folder rules/);
    expect(await mcp({ id: shared.id, parent_id: bobs.id }, "alice")).toBe(`parent folder not found: ${bobs.id}`);
    expect(await mcp({ id: shared.id, parent_id: foreign.id }, "alice")).toBe(`parent folder not found: ${foreign.id}`);
    expect((await testDb.folder.findUniqueOrThrow({ where: { id: bobs.id } })).name).toBe("Bob private");

    // What's allowed still works.
    expect(await mcp({ id: shared.id, name: "Team 2" }, "alice")).toBe("ok");
    expect(await mcp({ id: shared.id, visibility: "private" }, "bob")).toBe("ok");
    expect(await mcp({ id: bobs.id, name: "Mine" }, "bob")).toBe("ok");
  });

  it("PATCH /api/folders gets the same answers", async () => {
    const { bobs, stock, foreign, shared } = await folders();
    as("alice", "member");
    const patch = async (body: Record<string, unknown>) => {
      const res = await foldersPATCH(req("PATCH", "/api/folders", body));
      return [res.status, (await res.json()).error];
    };
    expect(await patch({ id: bobs.id, name: "pwned" })).toEqual([404, `folder not found: ${bobs.id}`]);
    expect(await patch({ id: stock.id, name: "x" })).toEqual([403, "stock folders cannot be modified"]);
    expect(await patch({ id: shared.id, parentId: foreign.id })).toEqual([404, `parent folder not found: ${foreign.id}`]);
    expect(await patch({ id: shared.id, parentId: bobs.id })).toEqual([404, `parent folder not found: ${bobs.id}`]);
    expect((await foldersPATCH(req("PATCH", "/api/folders", { id: shared.id, name: "Renamed" }))).status).toBe(200);
  });
});

describe("owner-only actions on private pages", () => {
  it("an editor share can edit, but not change visibility or delete", async () => {
    const priv = await page("priv", "bob", "private");
    await share(priv.id, "alice", "editor");
    as("alice");

    expect((await pagesPATCH(req("PATCH", "/api/pages", { slug: "priv", pinned: true }))).status).toBe(200);
    expect((await pagesPATCH(req("PATCH", "/api/pages", { slug: "priv", visibility: "org" }))).status).toBe(403);
    expect((await pagesDELETE(req("DELETE", "/api/pages?slug=priv"))).status).toBe(403);
    expect((await bulkPOST(req("POST", "/api/pages/bulk", { action: "delete", slugs: ["priv"] }))).status).toBe(403);
    expect((await bulkPOST(req("POST", "/api/pages/bulk", { action: "visibility", visibility: "org", slugs: ["priv"] }))).status).toBe(403);
    expect((await testDb.page.findUniqueOrThrow({ where: { id: priv.id } })).visibility).toBe("private");

    as("bob");
    expect((await pagesPATCH(req("PATCH", "/api/pages", { slug: "priv", visibility: "org" }))).status).toBe(200);
  });

  it("bulk counts a hidden slug exactly like a missing one", async () => {
    await page("priv", "bob", "private");
    await page("mine", "alice", "org");
    as("alice");
    const run = async (slugs: string[]) => {
      const res = await bulkPOST(req("POST", "/api/pages/bulk", { action: "restore", slugs }));
      return [res.status, await res.json()];
    };
    expect(await run(["mine", "priv"])).toEqual(await run(["mine", "nope"]));
    expect(await run(["priv"])).toEqual(await run(["nope"]));
  });
});

describe("MCP", () => {
  beforeEach(() => vi.stubEnv("AUTH_MODE", "oauth"));
  afterEach(() => vi.unstubAllEnvs());

  it("graph tools and create tools answer a hidden slug like a missing or taken one", async () => {
    const priv = await page("priv", "bob", "private");
    await upsertConcepts(priv.id, [{ term: "secret-term" }], "bob");
    await page("visible", "alice", "org");
    const { key } = await createTestApiKey(orgId, { createdBy: "alice" });
    const call = async (tool: string, args: Record<string, string>, slug: string) => {
      const res = await mcpPOST(new NextRequest("http://localhost/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ tool, args }),
      }));
      return [res.status, JSON.stringify(await res.json()).replaceAll(slug, "X")];
    };
    for (const tool of ["get_related", "get_dependents"]) {
      expect(await call(tool, { slug: "priv" }, "priv")).toEqual(await call(tool, { slug: "nope" }, "nope"));
    }
    expect(await call("map_dependencies", { term: "t", depends: "priv" }, "priv")).toEqual(await call("map_dependencies", { term: "t", depends: "nope" }, "nope"));
    expect(await call("get_related", { term: "secret-term" }, "secret-term")).toEqual(await call("get_related", { term: "never-used" }, "never-used"));

    const content = "title: T\nshell: document\ncomponents: []\n";
    expect(await call("create_page", { slug: "priv", content }, "priv")).toEqual(await call("create_page", { slug: "visible", content }, "visible"));
  });

  it("write_page can't change a private page's visibility through an editor share", async () => {
    const priv = await page("priv", "bob", "private");
    await share(priv.id, "alice", "editor");
    expect(await mcpPageDenial("write_page", { slug: "priv", content: "x", visibility: "org" }, orgId, "alice")).toMatch(/only the page owner/);
    expect(await mcpPageDenial("write_page", { slug: "priv", content: "x" }, orgId, "alice")).toBeNull();
    expect(await mcpPageDenial("write_page", { slug: "priv", content: "x", visibility: "org" }, orgId, "bob")).toBeNull();
  });

  it("a call naming a hidden and a view-only page always gets the hidden answer", async () => {
    await page("aaa-hidden", "bob", "private");
    const viewOnly = await page("zzz-view", "bob", "private");
    await share(viewOnly.id, "alice", "viewer");
    // Secondary page args answer in the tool's own words.
    expect(await mcpPageDenial("create_from_template", { template_slug: "aaa-hidden", target_slug: "new-one" }, orgId, "alice")).toBe("template not found: aaa-hidden");
    expect(await mcpPageDenial("flag_page", { slug: "zzz-view", action: "supersede", superseded_by: "aaa-hidden" }, orgId, "alice")).toBeNull();
    for (const slugs of [["zzz-view", "aaa-hidden"], ["aaa-hidden", "zzz-view"]]) {
      expect(await mcpPageDenial("patch_page", { slug: slugs[0], template_slug: slugs[1] }, orgId, "alice")).toBe("page not found: aaa-hidden");
    }
  });
});
