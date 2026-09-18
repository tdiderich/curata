import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { createTestOrg, createTestPage } from "./helpers";

vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});
const resolveOrgMock = vi.fn();
vi.mock("@/lib/auth", () => ({ resolveOrg: () => resolveOrgMock() }));

import { POST } from "@/app/api/tags/route";
import { getPageConcepts } from "@/lib/concepts";

function post(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/tags", {
    method: "POST",
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
