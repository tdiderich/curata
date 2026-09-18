import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { createTestOrg, createTestPage } from "./helpers";

vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});
const resolveOrgMock = vi.fn();
vi.mock("@/lib/auth", () => ({ resolveOrg: () => resolveOrgMock() }));

import { POST, DELETE } from "@/app/api/tags/route";
import { getPageConcepts } from "@/lib/concepts";

function post(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/tags", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
function del(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/tags", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/tags with rel", () => {
  it("sets the edge rel from the Tags tab picker, leaves it alone when absent, rejects junk", async () => {
    const org = await createTestOrg({ name: "Rel Org", slug: "rel-org" });
    resolveOrgMock.mockResolvedValue({ orgId: org.id, userId: "u1", role: "owner" });
    const page = await createTestPage(org.id, { slug: "rel-page" });

    expect((await POST(post({ pageId: page.id, tags: [{ term: "tagrel-a" }] }))).status).toBe(200);
    expect((await getPageConcepts(page.id)).find((c) => c.term === "tagrel-a")?.rel).toBe("references");

    expect((await POST(post({ pageId: page.id, tags: [{ term: "tagrel-a", rel: "depends" }] }))).status).toBe(200);
    expect((await getPageConcepts(page.id)).find((c) => c.term === "tagrel-a")?.rel).toBe("depends");

    // Re-adding without rel (the picker's add path) keeps depends.
    expect((await POST(post({ pageId: page.id, tags: ["tagrel-a"] }))).status).toBe(200);
    expect((await getPageConcepts(page.id)).find((c) => c.term === "tagrel-a")?.rel).toBe("depends");

    const bad = await POST(post({ pageId: page.id, tags: [{ term: "tagrel-a", rel: "owns" }] }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/rel must be one of/);
  });
});

describe("DELETE /api/tags: the Dependencies tab's Remove button", () => {
  it("adding a dependency in one step (the tab's + Add dependency form) and removing it round-trips cleanly", async () => {
    const org = await createTestOrg({ name: "Dep Add Org", slug: "dep-add-org" });
    resolveOrgMock.mockResolvedValue({ orgId: org.id, userId: "u1", role: "owner" });
    const page = await createTestPage(org.id, { slug: "dep-add-page" });

    // The add form posts term + rel in one call, no separate retag step.
    const add = await POST(post({ pageId: page.id, tags: [{ term: "dep-add/term", rel: "depends" }] }));
    expect(add.status).toBe(200);
    expect((await getPageConcepts(page.id)).find((c) => c.term === "dep-add/term")?.rel).toBe("depends");

    const remove = await DELETE(del({ pageId: page.id, tag: "dep-add/term" }));
    expect(remove.status).toBe(200);
    expect((await getPageConcepts(page.id)).find((c) => c.term === "dep-add/term")).toBeUndefined();

    // Wrong org can't touch it.
    const org2 = await createTestOrg({ name: "Other", slug: "dep-add-other" });
    await POST(post({ pageId: page.id, tags: [{ term: "dep-add/term2", rel: "depends" }] }));
    resolveOrgMock.mockResolvedValue({ orgId: org2.id, userId: "u2", role: "owner" });
    expect((await DELETE(del({ pageId: page.id, tag: "dep-add/term2" }))).status).toBe(404);
  });
});
