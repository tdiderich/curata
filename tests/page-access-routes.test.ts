import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { testDb } from "./setup";
import { createTestOrg, createTestPage, createTestApiKey } from "./helpers";

vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});

// Page-level access only applies outside AUTH_MODE=none, so run as an oauth
// deployment. Web routes get their caller from resolveOrgMock; MCP routes
// resolve a real API key.
const resolveOrgMock = vi.fn();
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  AUTH_MODE: "oauth",
  resolveOrg: () => resolveOrgMock(),
}));

vi.mock("@/lib/kazam", async (importOriginal) => {
  const os = await import("os");
  const path = await import("path");
  const tmpDir = path.join(os.tmpdir(), `curata-test-page-access-${process.pid}`);
  return {
    ...(await importOriginal<typeof import("@/lib/kazam")>()),
    sitePath: () => tmpDir,
    buildSite: vi.fn().mockResolvedValue(""),
    validateContent: vi.fn().mockResolvedValue([]),
    validateContentSplit: vi.fn().mockResolvedValue({ errors: [], warnings: [] }),
    checkUnsupportedComponents: vi.fn().mockReturnValue([]),
  };
});

// Export must answer before it ever launches a browser.
vi.mock("@/lib/export-render", () => ({
  getChromium: vi.fn().mockRejectedValue(new Error("no browser in tests")),
  previewUrl: vi.fn(),
  screenshotPage: vi.fn(),
  renderHtmlToPng: vi.fn(),
}));

import { POST as editPOST } from "@/app/api/edit/route";
import { GET as versionsGET, POST as versionsPOST } from "@/app/api/versions/route";
import { POST as trustPOST } from "@/app/api/versions/trust/route";
import { POST as reorderPOST } from "@/app/api/pages/reorder/route";
import { POST as bulkPOST } from "@/app/api/pages/bulk/route";
import { GET as exportGET, POST as exportPOST } from "@/app/api/export/route";
import { PATCH as pagesPATCH } from "@/app/api/pages/route";
import { PUT as yamlPUT } from "@/app/api/pages/yaml/route";
import { GET as rulesGET, POST as rulesPOST } from "@/app/api/rules/route";
import { POST as annotationsPOST } from "@/app/api/annotations/route";
import { POST as mcpPOST } from "@/app/api/mcp/route";
import { POST as streamPOST } from "@/app/api/mcp/stream/route";
import { mcpPageDenial, PAGE_ARGS } from "@/lib/mcp-page-access";
import { TOOL_PARAMS } from "@/lib/mcp-dispatch";

const PAGE_YAML = `title: Secret plan
shell: document
components:
  - id: secret
    type: markdown
    body: the private bit
`;

async function setup(visibility = "private") {
  const org = await createTestOrg({ slug: "acc-org" });
  const page = await createTestPage(org.id, { slug: "acc-page", createdBy: "author", visibility, yamlContent: PAGE_YAML });
  return { org, page };
}

async function share(pageId: string, userId: string, role: "viewer" | "editor") {
  await testDb.pageShare.create({ data: { pageId, userId, role, invitedBy: "author" } });
}

function as(orgId: string, userId: string, role = "admin") {
  resolveOrgMock.mockResolvedValue({ orgId, orgSlug: "acc-org", userId, role });
}

const json = (method: string, path: string, body: unknown) =>
  new NextRequest(`http://localhost${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const get = (path: string) => new NextRequest(`http://localhost${path}`);

const versionCount = (pageId: string) => testDb.pageVersion.count({ where: { pageId } });

describe("web routes hide private pages from non-members of the page", () => {
  it("edit, versions, reorder, trust and export answer 404", async () => {
    const { org, page } = await setup();
    as(org.id, "outsider");

    expect((await editPOST(json("POST", "/api/edit", { slug: "acc-page", target: "private bit", replacement: "x" }))).status).toBe(404);
    expect((await versionsGET(get("/api/versions?slug=acc-page"))).status).toBe(404);
    expect((await reorderPOST(json("POST", "/api/pages/reorder", { slug: "acc-page", op: "remove", componentId: "secret" }))).status).toBe(404);
    expect((await trustPOST(json("POST", "/api/versions/trust", { slug: "acc-page", versionId: "v" }))).status).toBe(404);
    expect((await exportGET(get("/api/export?slug=acc-page"))).status).toBe(404);
    expect((await exportPOST(json("POST", "/api/export", { slugs: ["acc-page"] }))).status).toBe(404);
    expect(await versionCount(page.id)).toBe(1);
  });

  it("page-scope rules and annotations answer 404", async () => {
    const { org, page } = await setup();
    as(org.id, "outsider");

    expect((await rulesGET(get("/api/rules?scope=page:acc-page"))).status).toBe(404);
    const rule = { id: "r1", kind: "content", text: "no", mode: "block", pattern: "x" };
    expect((await rulesPOST(json("POST", "/api/rules?scope=page:acc-page", rule))).status).toBe(404);
    expect((await annotationsPOST(json("POST", "/api/annotations", { slug: "acc-page", text: "hi" }))).status).toBe(404);
    expect((await annotationsPOST(json("POST", "/api/annotations", { slug: "no-such-page", text: "hi" }))).status).toBe(404);

    expect(await testDb.annotation.count()).toBe(0);
    expect((await testDb.page.findUniqueOrThrow({ where: { id: page.id } })).rules).toBeNull();
  });

  it("export ignores a hub page that doesn't exist, as before", async () => {
    const { org } = await setup("org");
    as(org.id, "outsider");
    // Past the access check, the mocked browser launch fails with 501.
    expect((await exportGET(get("/api/export?slug=acc-page&hub=no-such-hub"))).status).toBe(501);
  });

  it("export also refuses a hidden hub page", async () => {
    const { org } = await setup();
    await createTestPage(org.id, { slug: "open-page", createdBy: "author", visibility: "org" });
    as(org.id, "outsider");

    const res = await exportGET(get("/api/export?slug=open-page&hub=acc-page"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("page not found: acc-page");
  });

  it("bulk treats hidden pages as not matching", async () => {
    const { org, page } = await setup();
    as(org.id, "outsider");

    const res = await bulkPOST(json("POST", "/api/pages/bulk", { action: "visibility", slugs: ["acc-page"], visibility: "public" }));
    expect(res.status).toBe(404);
    expect((await testDb.page.findUniqueOrThrow({ where: { id: page.id } })).visibility).toBe("private");
  });
});

describe("a viewer share on a private page is read-only, whatever the org role", () => {
  it("can read versions but not change the page", async () => {
    const { org, page } = await setup();
    await share(page.id, "viewer-user", "viewer");
    as(org.id, "viewer-user", "admin");

    expect((await versionsGET(get("/api/versions?slug=acc-page"))).status).toBe(200);

    const versionId = (await testDb.pageVersion.findFirstOrThrow({ where: { pageId: page.id } })).id;
    expect((await versionsPOST(json("POST", "/api/versions", { slug: "acc-page", versionId }))).status).toBe(403);
    expect((await editPOST(json("POST", "/api/edit", { slug: "acc-page", target: "private bit", replacement: "x" }))).status).toBe(403);
    expect((await reorderPOST(json("POST", "/api/pages/reorder", { slug: "acc-page", op: "remove", componentId: "secret" }))).status).toBe(403);
    expect((await pagesPATCH(json("PATCH", "/api/pages", { slug: "acc-page", visibility: "public" }))).status).toBe(403);
    expect((await yamlPUT(json("PUT", "/api/pages/yaml", { slug: "acc-page", yaml: "title: Overwritten\nshell: document\ncomponents: []\n" }))).status).toBe(403);
    expect((await bulkPOST(json("POST", "/api/pages/bulk", { action: "visibility", slugs: ["acc-page"], visibility: "public" }))).status).toBe(404);

    expect(await versionCount(page.id)).toBe(1);
    expect((await testDb.page.findUniqueOrThrow({ where: { id: page.id } })).visibility).toBe("private");
  });

  it("an editor share can change it", async () => {
    const { org, page } = await setup();
    await share(page.id, "editor-user", "editor");
    as(org.id, "editor-user", "member");

    const res = await editPOST(json("POST", "/api/edit", { slug: "acc-page", target: "private bit", replacement: "shared bit" }));
    expect(res.status).toBe(200);
    expect(await versionCount(page.id)).toBe(2);
  });

  it("a viewer share on an org page leaves the org role in charge", async () => {
    const { org, page } = await setup("org");
    await share(page.id, "viewer-user", "viewer");
    as(org.id, "viewer-user", "member");

    const res = await editPOST(json("POST", "/api/edit", { slug: "acc-page", target: "private bit", replacement: "org bit" }));
    expect(res.status).toBe(200);
  });
});

describe("MCP page access", () => {
  // The stream route reads AUTH_MODE from the environment per request.
  beforeEach(() => vi.stubEnv("AUTH_MODE", "oauth"));
  afterEach(() => vi.unstubAllEnvs());

  it("mcpPageDenial: hidden pages read as not found, missing pages pass, viewer shares can't edit", async () => {
    const { org, page } = await setup();
    await share(page.id, "viewer-user", "viewer");

    expect(await mcpPageDenial("read_page", { slug: "acc-page" }, org.id, "outsider")).toBe("page not found: acc-page");
    expect(await mcpPageDenial("export_report", { slugs: JSON.stringify(["acc-page"]) }, org.id, "outsider")).toBe("page not found: acc-page");
    expect(await mcpPageDenial("create_from_template", { template_slug: "acc-page", target_slug: "new" }, org.id, "outsider")).toBe("page not found: acc-page");
    expect(await mcpPageDenial("write_page", { slug: "brand-new" }, org.id, "outsider")).toBeNull();
    // camelCase aliases and slug lists are checked like the canonical args
    expect(await mcpPageDenial("create_from_template", { templateSlug: "acc-page", target_slug: "new" }, org.id, "outsider")).toBe("page not found: acc-page");
    expect(await mcpPageDenial("flag_page", { slug: "other", action: "supersede", supersededBy: "acc-page" }, org.id, "outsider")).toBe("page not found: acc-page");
    expect(await mcpPageDenial("map_dependencies", { term: "t", asserts: "other, acc-page" }, org.id, "outsider")).toBe("page not found: acc-page");
    expect(await mcpPageDenial("map_dependencies", { term: "t", depends: ["acc-page"] }, org.id, "outsider")).toBe("page not found: acc-page");

    expect(await mcpPageDenial("read_page", { slug: "acc-page" }, org.id, "viewer-user")).toBeNull();
    expect(await mcpPageDenial("patch_page", { slug: "acc-page" }, org.id, "viewer-user")).toContain("view-only");
    expect(await mcpPageDenial("set_rules", { scope: "page", scope_id: "acc-page" }, org.id, "viewer-user")).toContain("view-only");

    expect(await mcpPageDenial("patch_page", { slug: "acc-page" }, org.id, "author")).toBeNull();
  });

  it("covers every page-naming param a tool accepts", () => {
    const pageish = /slug|superseded_by|scope_id|asserts|depends|references/;
    const missed = Object.entries(TOOL_PARAMS).flatMap(([tool, spec]) =>
      [...spec.known].filter((p) => pageish.test(p) && !(PAGE_ARGS as readonly string[]).includes(p)).map((p) => `${tool}.${p}`));
    expect(missed).toEqual([]);
  });

  it("POST /api/mcp answers a hidden page like a missing one", async () => {
    const { org } = await setup();
    const { key } = await createTestApiKey(org.id, { createdBy: "outsider" });

    const call = async (slug: string) => {
      const res = await mcpPOST(new NextRequest("http://localhost/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ tool: "read_page", args: { slug } }),
      }));
      return { status: res.status, error: (await res.json()).error as string };
    };

    const hidden = await call("acc-page");
    const missing = await call("no-such-page");
    expect(hidden.status).toBe(missing.status);
    expect(hidden.error).toBe("page not found: acc-page");
    expect(missing.error).toBe("page not found: no-such-page");
  });

  it("the stream transport guards its own handlers too", async () => {
    const { org, page } = await setup();
    await share(page.id, "viewer-user", "viewer");
    const outsider = (await createTestApiKey(org.id, { createdBy: "outsider" })).key;
    const viewer = (await createTestApiKey(org.id, { createdBy: "viewer-user" })).key;

    const call = async (key: string, name: string, args: Record<string, unknown>) => {
      const res = await streamPOST(new Request("http://localhost/api/mcp/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
      }));
      expect(res.status).toBe(200);
      return res.text();
    };

    const read = await call(outsider, "read_page", { slug: "acc-page" });
    expect(read).toContain("page not found: acc-page");
    expect(read).not.toContain("private bit");

    // replace_in_page and restore_page_version only exist on this transport.
    expect(await call(viewer, "replace_in_page", { slug: "acc-page", target: "private bit", replacement: "x" })).toContain("view-only");
    expect(await call(viewer, "restore_page_version", { slug: "acc-page", version_id: "v" })).toContain("view-only");
    expect(await versionCount(page.id)).toBe(1);

    expect(await call(viewer, "read_page", { slug: "acc-page" })).toContain("private bit");
  });
});
