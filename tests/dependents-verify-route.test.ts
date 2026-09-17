import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { testDb } from "./setup";
import { createTestOrg, createTestPage } from "./helpers";

vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});

const resolveOrgMock = vi.fn();
vi.mock("@/lib/auth", () => ({ resolveOrg: () => resolveOrgMock() }));

import { POST } from "@/app/api/dependents/verify/route";
import { upsertConcepts, upsertExternalDependents, getDependents } from "@/lib/concepts";

function post(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/dependents/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/dependents/verify", () => {
  it("verifies a page and an external asset with a note, scoped to the org", async () => {
    const org = await createTestOrg({ name: "V Org", slug: "v-org" });
    const other = await createTestOrg({ name: "Other", slug: "other-v-org" });
    resolveOrgMock.mockResolvedValue({ orgId: org.id, userId: "user-1", role: "owner" });

    const src = await createTestPage(org.id, { slug: "v-src" });
    const dep = await createTestPage(org.id, { slug: "v-dep" });
    await upsertConcepts(src.id, [{ term: "vr-term", rel: "asserts" }], "agent");
    await upsertConcepts(dep.id, [{ term: "vr-term", rel: "depends" }], "agent");
    await upsertExternalDependents(org.id, "vr-term", [{ url: "https://example.com/deck" }], "agent");
    await testDb.page.update({ where: { id: dep.id }, data: { verifiedAt: null } });

    const r1 = await POST(post({ slug: "v-dep", note: "still fine" }));
    expect(r1.status).toBe(200);
    expect((await r1.json()).note).toBe("still fine");

    const r2 = await POST(post({ url: "https://example.com/deck/", term: "vr-term" }));
    expect(r2.status).toBe(200);

    const g = await getDependents(org.id, { term: "vr-term" });
    expect(g.dependents[0].verifiedNote).toBe("still fine");
    expect(g.dependents[0].staleAgainstSource).toBe(false);
    expect(g.external[0].verifiedAt).not.toBeNull();

    // Another org cannot verify this org's rows.
    resolveOrgMock.mockResolvedValue({ orgId: other.id, userId: "user-2", role: "owner" });
    expect((await POST(post({ slug: "v-dep" }))).status).toBe(404);
    expect((await POST(post({ url: "https://example.com/deck" }))).status).toBe(404);

    resolveOrgMock.mockResolvedValue(null);
    expect((await POST(post({ slug: "v-dep" }))).status).toBe(401);
    resolveOrgMock.mockResolvedValue({ orgId: org.id, userId: "user-1", role: "owner" });
    expect((await POST(post({}))).status).toBe(400);
  });
});
