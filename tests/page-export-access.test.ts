import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { testDb } from "./setup";
import { createTestOrg, createTestPage } from "./helpers";

vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});

// Page-level access only applies outside AUTH_MODE=none (where every caller
// is the single default owner), so run these routes as an oauth deployment.
const resolveOrgMock = vi.fn();
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  AUTH_MODE: "oauth",
  resolveOrg: () => resolveOrgMock(),
}));

vi.mock("@/lib/kazam", async (importOriginal) => {
  const os = await import("os");
  const path = await import("path");
  const tmpDir = path.join(os.tmpdir(), `curata-test-export-access-${process.pid}`);
  return {
    ...(await importOriginal<typeof import("@/lib/kazam")>()),
    sitePath: () => tmpDir,
    buildSite: vi.fn().mockResolvedValue(""),
    validateContent: vi.fn().mockResolvedValue([]),
    validateContentSplit: vi.fn().mockResolvedValue({ errors: [], warnings: [] }),
    checkUnsupportedComponents: vi.fn().mockReturnValue([]),
  };
});

import { GET as yamlGET, PUT as yamlPUT } from "@/app/api/pages/yaml/route";
import { GET as compGET, PUT as compPUT } from "@/app/api/pages/component-yaml/route";

const PAGE_YAML = `title: Secret plan
shell: document
components:
  - id: secret
    type: markdown
    body: the private bit
`;

async function setup(visibility: string) {
  const org = await createTestOrg({ slug: "exp-org" });
  await createTestPage(org.id, { slug: "exp-page", createdBy: "author", visibility, yamlContent: PAGE_YAML });
  return org;
}

function as(orgId: string, userId: string, role = "member") {
  resolveOrgMock.mockResolvedValue({ orgId, orgSlug: "exp-org", userId, role });
}

const get = (path: string) => new NextRequest(`http://localhost${path}`);
const put = (path: string, body: unknown) => new NextRequest(`http://localhost${path}`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

describe("page export routes enforce page-level access", () => {
  it("hide a private page from an org member who isn't its creator", async () => {
    const org = await setup("private");
    as(org.id, "someone-else");

    const y = await yamlGET(get("/api/pages/yaml?slug=exp-page"));
    expect(y.status).toBe(404);
    expect(JSON.stringify(await y.json())).not.toContain("private bit");

    const c = await compGET(get("/api/pages/component-yaml?slug=exp-page&id=secret"));
    expect(c.status).toBe(404);
    expect(JSON.stringify(await c.json())).not.toContain("private bit");
  });

  it("block writes to a private page the caller can't see", async () => {
    const org = await setup("private");
    as(org.id, "someone-else", "admin");

    const y = await yamlPUT(put("/api/pages/yaml", { slug: "exp-page", yaml: "title: Overwritten\nshell: document\ncomponents: []\n" }));
    expect(y.status).toBe(404);

    const c = await compPUT(put("/api/pages/component-yaml", { slug: "exp-page", id: "secret", yaml: "type: markdown\nbody: overwritten\n" }));
    expect(c.status).toBe(404);

    const versions = await testDb.pageVersion.count({ where: { page: { orgId: org.id, slug: "exp-page" } } });
    expect(versions).toBe(1);
  });

  it("still serve the private page to its creator", async () => {
    const org = await setup("private");
    as(org.id, "author");

    const y = await yamlGET(get("/api/pages/yaml?slug=exp-page"));
    expect(y.status).toBe(200);
    expect((await y.json()).yaml).toContain("private bit");

    const c = await compGET(get("/api/pages/component-yaml?slug=exp-page&id=secret"));
    expect(c.status).toBe(200);
    expect((await c.json()).yaml).toContain("private bit");
  });

  it("still serve org-visible pages to any member", async () => {
    const org = await setup("org");
    as(org.id, "someone-else");

    expect((await yamlGET(get("/api/pages/yaml?slug=exp-page"))).status).toBe(200);
    expect((await compGET(get("/api/pages/component-yaml?slug=exp-page&id=secret"))).status).toBe(200);
  });
});
