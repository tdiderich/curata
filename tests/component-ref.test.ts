import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { testDb } from "./setup";
import { createTestOrg, createTestPage } from "./helpers";

// Mock db to use test database
vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});

// No filesystem/browser side effects from tools unrelated to component refs.
vi.mock("@/lib/kazam", async () => {
  const os = await import("os");
  const path = await import("path");
  const tmpDir = path.join(os.tmpdir(), `curata-test-component-ref-${process.pid}`);
  return {
    sitePath: () => tmpDir,
    buildSite: vi.fn().mockResolvedValue(""),
    validateContent: vi.fn().mockResolvedValue([]),
    checkUnsupportedComponents: vi.fn().mockReturnValue([]),
  };
});

import { expandComponentRefs, expandSlideRefs, renderedRefWrap, agentRefWrap, MAX_REF_DEPTH } from "@/lib/component-refs";
import { dispatch } from "@/lib/mcp-dispatch";
import { GET as mdGET } from "@/app/p/[orgSlug]/[pageSlug]/md/route";
import { GET as promptGET } from "@/app/p/[orgSlug]/[pageSlug]/prompt/route";
import { GET as rawGET } from "@/app/p/[orgSlug]/[pageSlug]/raw/route";
import yaml from "js-yaml";

const REF_WRAP = renderedRefWrap((slug) => `/pages/${slug}`);

async function createComponentPage(
  orgId: string,
  slug: string,
  opts: { title?: string; body?: string; visibility?: string; createdBy?: string } = {}
) {
  const content = `title: "${opts.title ?? slug}"\nshell: document\npageType: component\ncomponents:\n  - type: markdown\n    id: body\n    body: "${opts.body ?? "content"}"\n`;
  return createTestPage(orgId, {
    slug,
    yamlContent: content,
    visibility: opts.visibility,
    createdBy: opts.createdBy ?? "test-user",
  });
}

function refBlock(slug: string, id = "embed-1") {
  return { type: "ref", id, component: slug };
}

describe("expandComponentRefs", () => {
  let orgId: string;

  beforeEach(async () => {
    const org = await createTestOrg({ name: "Ref Org", slug: "ref-org" });
    orgId = org.id;
  });

  it("expands a ref block into the target component page's content and adds an attribution chip", async () => {
    await createComponentPage(orgId, "shared-a", { title: "Shared A", body: "hello from shared a" });

    const out = await expandComponentRefs([refBlock("shared-a")], {
      orgId,
      channel: "latest",
      viewer: { userId: null, orgMemberRole: "member" },
      ...REF_WRAP,
    });

    const joined = JSON.stringify(out);
    expect(joined).toContain("hello from shared a");
    expect(joined).toContain("shared: [Shared A](/pages/shared-a)");
  });

  it("resolves the trusted channel to the pinned version and latest to the newest version", async () => {
    const page = await createComponentPage(orgId, "shared-versioned", { body: "V1 content" });
    const v1Id = page.versions[0].id;
    await testDb.pageVersion.create({
      data: {
        pageId: page.id,
        yamlContent: `title: Shared Versioned\nshell: document\npageType: component\ncomponents:\n  - type: markdown\n    id: body\n    body: "V2 content"\n`,
        contentHash: "v2-hash",
        createdBy: "test-user",
      },
    });
    await testDb.page.update({ where: { id: page.id }, data: { trustedVersionId: v1Id } });

    const trustedOut = await expandComponentRefs([refBlock("shared-versioned")], {
      orgId,
      channel: "trusted",
      viewer: { userId: null, orgMemberRole: "member" },
      ...REF_WRAP,
    });
    expect(JSON.stringify(trustedOut)).toContain("V1 content");
    expect(JSON.stringify(trustedOut)).not.toContain("V2 content");

    const latestOut = await expandComponentRefs([refBlock("shared-versioned")], {
      orgId,
      channel: "latest",
      viewer: { userId: null, orgMemberRole: "member" },
      ...REF_WRAP,
    });
    expect(JSON.stringify(latestOut)).toContain("V2 content");
    expect(JSON.stringify(latestOut)).not.toContain("V1 content");
  });

  it("renders an access-denied placeholder, never the target's content, for a private page the viewer can't see", async () => {
    await createComponentPage(orgId, "shared-private", {
      body: "secret content",
      visibility: "private",
      createdBy: "owner-user",
    });

    const out = await expandComponentRefs([refBlock("shared-private")], {
      orgId,
      channel: "latest",
      viewer: { userId: "someone-else", orgMemberRole: null },
      ...REF_WRAP,
    });

    const joined = JSON.stringify(out);
    expect(joined).not.toContain("secret content");
    expect(joined).toContain("shared-private");
    expect(out[0].type).toBe("callout");
    expect(out[0].variant).toBe("warn");
  });

  it("renders a missing-target placeholder when the referenced slug doesn't exist", async () => {
    const out = await expandComponentRefs([refBlock("no-such-page")], {
      orgId,
      channel: "latest",
      viewer: { userId: null, orgMemberRole: "member" },
      ...REF_WRAP,
    });
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("callout");
    expect(JSON.stringify(out[0])).toContain("no-such-page");
  });

  it("renders a placeholder when the target page isn't pageType: component", async () => {
    await createTestPage(orgId, {
      slug: "just-a-page",
      yamlContent: `title: Just A Page\nshell: document\ncomponents:\n  - type: markdown\n    body: "leaked untyped body text"\n`,
    });

    const out = await expandComponentRefs([refBlock("just-a-page")], {
      orgId,
      channel: "latest",
      viewer: { userId: null, orgMemberRole: "member" },
      ...REF_WRAP,
    });
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("callout");
    expect(JSON.stringify(out[0])).toContain("not a component page");
    expect(JSON.stringify(out[0])).not.toContain("leaked untyped body text");
  });

  it("catches a ref cycle and renders a placeholder instead of looping", async () => {
    await createTestPage(orgId, {
      slug: "cycle-a",
      yamlContent: `title: Cycle A\nshell: document\npageType: component\ncomponents:\n  - type: ref\n    id: to-b\n    component: cycle-b\n`,
    });
    await createTestPage(orgId, {
      slug: "cycle-b",
      yamlContent: `title: Cycle B\nshell: document\npageType: component\ncomponents:\n  - type: ref\n    id: to-a\n    component: cycle-a\n`,
    });

    const out = await expandComponentRefs([refBlock("cycle-a")], {
      orgId,
      channel: "latest",
      viewer: { userId: null, orgMemberRole: "member" },
      ...REF_WRAP,
    });

    const joined = JSON.stringify(out);
    expect(joined).toContain("cycle detected");
    expect(joined).toContain("cycle-a");
  });

  it("stops at the max expansion depth instead of expanding indefinitely", async () => {
    await createTestPage(orgId, {
      slug: "depth-4",
      yamlContent: `title: Depth 4\nshell: document\npageType: component\ncomponents:\n  - type: markdown\n    body: "bottom"\n`,
    });
    await createTestPage(orgId, {
      slug: "depth-3",
      yamlContent: `title: Depth 3\nshell: document\npageType: component\ncomponents:\n  - type: ref\n    id: r\n    component: depth-4\n`,
    });
    await createTestPage(orgId, {
      slug: "depth-2",
      yamlContent: `title: Depth 2\nshell: document\npageType: component\ncomponents:\n  - type: ref\n    id: r\n    component: depth-3\n`,
    });
    await createTestPage(orgId, {
      slug: "depth-1",
      yamlContent: `title: Depth 1\nshell: document\npageType: component\ncomponents:\n  - type: ref\n    id: r\n    component: depth-2\n`,
    });

    const out = await expandComponentRefs([refBlock("depth-1")], {
      orgId,
      channel: "latest",
      viewer: { userId: null, orgMemberRole: "member" },
      ...REF_WRAP,
    });

    const joined = JSON.stringify(out);
    expect(joined).not.toContain("bottom");
    expect(joined).toContain(`${MAX_REF_DEPTH}`);
    expect(joined).toMatch(/depth|deep/i);
  });

  it("namespaces expanded component ids so they can't collide with ids already on the page", async () => {
    await createComponentPage(orgId, "shared-ids", { body: "hi" });

    const out = await expandComponentRefs([refBlock("shared-ids", "my-embed")], {
      orgId,
      channel: "latest",
      viewer: { userId: null, orgMemberRole: "member" },
      ...REF_WRAP,
    });

    const ids = out.map((c) => c.id).filter(Boolean);
    expect(ids.some((id) => id === "my-embed--body")).toBe(true);
  });

  it("wraps expanded content for MCP with a marker naming the source slug and how to edit it", async () => {
    await createComponentPage(orgId, "shared-agent", { title: "Agent Shared", body: "agent view" });

    const out = await expandComponentRefs([refBlock("shared-agent")], {
      orgId,
      channel: "latest",
      viewer: { userId: "agent-user", orgMemberRole: "member" },
      ...agentRefWrap(),
    });

    const joined = JSON.stringify(out);
    expect(joined).toContain("shared-agent");
    expect(joined).toContain("patch_page");
    expect(joined).toContain("agent view");
  });

  it("passes through components with no refs unchanged", async () => {
    const components = [{ type: "markdown", id: "plain", body: "no refs here" }];
    const out = await expandComponentRefs(components, {
      orgId,
      channel: "latest",
      viewer: { userId: null, orgMemberRole: "member" },
      ...REF_WRAP,
    });
    expect(out).toEqual(components);
  });
});

describe("expandSlideRefs", () => {
  let orgId: string;

  beforeEach(async () => {
    const org = await createTestOrg({ name: "Slide Ref Org", slug: "slide-ref-org" });
    orgId = org.id;
  });

  it("expands a ref block inside a slide's components, with attribution", async () => {
    await createComponentPage(orgId, "shared-slide", { title: "Shared Slide", body: "slide body content" });

    const slides = [{ label: "Slide 1", components: [refBlock("shared-slide")] }];
    const out = await expandSlideRefs(slides, {
      orgId,
      channel: "latest",
      viewer: { userId: null, orgMemberRole: "member" },
      ...REF_WRAP,
    });

    const joined = JSON.stringify(out);
    expect(joined).toContain("slide body content");
    expect(joined).toContain("shared: [Shared Slide]");
  });

  it("catches a ref cycle inside a slide the same way the main components tree does", async () => {
    await createTestPage(orgId, {
      slug: "slide-cycle-a",
      yamlContent: `title: Slide Cycle A\nshell: document\npageType: component\ncomponents:\n  - type: ref\n    id: to-b\n    component: slide-cycle-b\n`,
    });
    await createTestPage(orgId, {
      slug: "slide-cycle-b",
      yamlContent: `title: Slide Cycle B\nshell: document\npageType: component\ncomponents:\n  - type: ref\n    id: to-a\n    component: slide-cycle-a\n`,
    });

    const slides = [{ label: "Slide 1", components: [refBlock("slide-cycle-a")] }];
    const out = await expandSlideRefs(slides, {
      orgId,
      channel: "latest",
      viewer: { userId: null, orgMemberRole: "member" },
      ...REF_WRAP,
    });

    const joined = JSON.stringify(out);
    expect(joined).toContain("cycle detected");
    expect(joined).toContain("slide-cycle-a");
  });

  it("passes a slide with no components through unchanged", async () => {
    const slides = [{ label: "Cover", cover: true }];
    const out = await expandSlideRefs(slides, {
      orgId,
      channel: "latest",
      viewer: { userId: null, orgMemberRole: "member" },
      ...REF_WRAP,
    });
    expect(out).toEqual(slides);
  });

  it("returns an empty array for undefined/null slides", async () => {
    expect(
      await expandSlideRefs(undefined, {
        orgId,
        channel: "latest",
        viewer: { userId: null, orgMemberRole: "member" },
        ...REF_WRAP,
      })
    ).toEqual([]);
    expect(
      await expandSlideRefs(null, {
        orgId,
        channel: "latest",
        viewer: { userId: null, orgMemberRole: "member" },
        ...REF_WRAP,
      })
    ).toEqual([]);
  });
});

describe("public /p/ sub-routes — ref expansion parity", () => {
  let orgId: string;
  const orgSlug = "ref-public-org";

  beforeEach(async () => {
    const org = await createTestOrg({ name: "Ref Public Org", slug: orgSlug });
    orgId = org.id;
  });

  function ctxFor(pageSlug: string) {
    return { params: Promise.resolve({ orgSlug, pageSlug }) };
  }

  it("GET .../md expands a ref block into the target's content, with attribution", async () => {
    await createComponentPage(orgId, "shared-md", { title: "Shared MD", body: "md body content", visibility: "public" });
    await createTestPage(orgId, {
      slug: "consumer-md",
      visibility: "public",
      yamlContent: `title: Consumer MD\nshell: document\ncomponents:\n  - type: ref\n    id: embed\n    component: shared-md\n`,
    });

    const res = await mdGET(
      new Request(`https://example.com/p/${orgSlug}/consumer-md/md`),
      ctxFor("consumer-md")
    );
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain("md body content");
    expect(body).toContain("Shared MD");
  });

  it("GET .../md never leaks a private, inaccessible ref's content", async () => {
    await createComponentPage(orgId, "shared-md-private", {
      body: "secret md content",
      visibility: "private",
      createdBy: "owner-user",
    });
    await createTestPage(orgId, {
      slug: "consumer-md-private-ref",
      visibility: "public",
      yamlContent: `title: Consumer\nshell: document\ncomponents:\n  - type: ref\n    id: embed\n    component: shared-md-private\n`,
    });

    const res = await mdGET(
      new Request(`https://example.com/p/${orgSlug}/consumer-md-private-ref/md`),
      ctxFor("consumer-md-private-ref")
    );
    const body = await res.text();

    expect(body).not.toContain("secret md content");
  });

  it("GET .../prompt appends the ref-expanded page content, with attribution", async () => {
    await createComponentPage(orgId, "shared-prompt", { title: "Shared Prompt", body: "prompt body content", visibility: "public" });
    await createTestPage(orgId, {
      slug: "consumer-prompt",
      visibility: "public",
      yamlContent: `title: Consumer Prompt\nshell: document\ncomponents:\n  - type: ref\n    id: embed\n    component: shared-prompt\n`,
    });

    const res = await promptGET(
      new Request(`https://example.com/p/${orgSlug}/consumer-prompt/prompt`),
      ctxFor("consumer-prompt")
    );
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain("prompt body content");
    expect(body).toContain("Shared Prompt");
  });

  it("GET .../raw returns the stored ref block unexpanded — the stored doc, not a rendered view", async () => {
    await createComponentPage(orgId, "shared-raw", { title: "Shared Raw", body: "raw body content" });
    await createTestPage(orgId, {
      slug: "consumer-raw",
      visibility: "public",
      yamlContent: `title: Consumer Raw\nshell: document\ncomponents:\n  - type: ref\n    id: embed\n    component: shared-raw\n`,
    });

    const res = await rawGET(
      new Request(`https://example.com/p/${orgSlug}/consumer-raw/raw`),
      ctxFor("consumer-raw")
    );
    const body = await res.text();

    expect(body).toContain("component: shared-raw");
    expect(body).not.toContain("raw body content");
  });
});

describe("shared components — write-path validation", () => {
  let orgId: string;
  let orgSlug: string;

  beforeEach(async () => {
    const org = await createTestOrg({ name: "Ref Write Org", slug: "ref-write-org" });
    orgId = org.id;
    orgSlug = org.slug;
  });

  it("create_page accepts a type: ref block", async () => {
    await createComponentPage(orgId, "shared-target");

    const content = `title: Consumer\nshell: document\ncomponents:\n  - type: ref\n    component: shared-target\n`;
    const result = (await dispatch(
      "create_page",
      { slug: "consumer-page", content },
      orgId,
      orgSlug,
      "apikey-1",
      "user-1"
    )) as { ok: boolean };
    expect(result.ok).toBe(true);
  });

  it("required-components validates the stored (unexpanded) doc — a ref alone doesn't satisfy a rule requiring a component id that only exists inside the referenced page", async () => {
    await testDb.organization.update({
      where: { id: orgId },
      data: {
        rules: [
          {
            id: "consumer-shape",
            kind: "required-components",
            pageType: "consumer",
            requiredComponentIds: ["real-content"],
          },
        ],
      },
    });
    await createTestPage(orgId, {
      slug: "shared-target-2",
      yamlContent: `title: Shared Target 2\nshell: document\npageType: component\ncomponents:\n  - type: markdown\n    id: real-content\n    body: "hi"\n`,
    });

    const content = `title: Consumer\nshell: document\npageType: consumer\ncomponents:\n  - type: ref\n    id: embed\n    component: shared-target-2\n`;
    await expect(
      dispatch("create_page", { slug: "consumer-bad", content }, orgId, orgSlug, "apikey-1", "user-1")
    ).rejects.toThrow(/required-components rule violation/);
  });

  it("patch_page targets the ref block itself — no expansion machinery needed on the write path", async () => {
    await createComponentPage(orgId, "shared-target-3");
    const content = `title: Consumer\nshell: document\ncomponents:\n  - type: ref\n    id: embed-1\n    component: shared-target-3\n`;
    const created = (await dispatch(
      "create_page",
      { slug: "consumer-patch", content },
      orgId,
      orgSlug,
      "apikey-1",
      "user-1"
    )) as { contentHash: string };

    const patched = (await dispatch(
      "patch_page",
      {
        slug: "consumer-patch",
        expected_hash: created.contentHash,
        operations: JSON.stringify([{ op: "remove", id: "embed-1" }]),
      },
      orgId,
      orgSlug,
      "apikey-1",
      "user-1"
    )) as { ok: boolean };
    expect(patched.ok).toBe(true);

    const stored = await testDb.page.findUnique({
      where: { orgId_slug: { orgId, slug: "consumer-patch" } },
      include: { versions: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    const parsed = yaml.load(stored!.versions[0].yamlContent) as { components: unknown[] };
    expect(parsed.components).toEqual([]);
  });
});

describe("shared components — starter templates", () => {
  let orgId: string;
  let orgSlug: string;

  beforeEach(async () => {
    const org = await createTestOrg({ name: "Ref Template Org", slug: "ref-template-org" });
    orgId = org.id;
    orgSlug = org.slug;
  });

  it("instantiates the event-timeline starter template as a pageType: component page via create_from_template", async () => {
    const templatesDir = path.join(process.cwd(), "seed", "templates");
    const templateContent = fs.readFileSync(path.join(templatesDir, "event-timeline.yaml"), "utf-8");

    const folder = await testDb.folder.create({
      data: { orgId, name: "Templates", createdBy: "system", locked: true },
    });
    await testDb.page.create({
      data: {
        orgId,
        folderId: folder.id,
        slug: "event-timeline",
        title: "Event Timeline",
        createdBy: "system",
        versions: { create: { yamlContent: templateContent, contentHash: "seed-hash", createdBy: "system" } },
      },
    });

    const result = (await dispatch(
      "create_from_template",
      { template_slug: "event-timeline", target_slug: "our-timeline" },
      orgId,
      orgSlug,
      "apikey-1",
      "user-1"
    )) as { ok: boolean; slug: string };
    expect(result.ok).toBe(true);

    const created = await testDb.page.findUnique({
      where: { orgId_slug: { orgId, slug: "our-timeline" } },
      include: { versions: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    const parsed = yaml.load(created!.versions[0].yamlContent) as { pageType?: string; components: unknown[] };
    expect(parsed.pageType).toBe("component");
    expect(parsed.components.length).toBeGreaterThan(0);
  });
});
