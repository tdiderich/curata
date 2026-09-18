import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { createTestOrg, createTestPage } from "./helpers";

vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});
const resolveOrgMock = vi.fn();
vi.mock("@/lib/auth", () => ({ resolveOrg: () => resolveOrgMock() }));

import { POST } from "@/app/api/dependents/map/route";
import { getDependents } from "@/lib/concepts";

function post(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/dependents/map", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/dependents/map", () => {
  it("builds a graph from the New map form and lands where an agent would", async () => {
    const org = await createTestOrg({ name: "NM Org", slug: "nm-org" });
    resolveOrgMock.mockResolvedValue({ orgId: org.id, userId: "u1", role: "owner" });
    await createTestPage(org.id, { slug: "nm-src" });
    await createTestPage(org.id, { slug: "nm-a" });
    await createTestPage(org.id, { slug: "nm-b" });

    const res = await POST(post({
      term: "Feature / SSO",
      kind: "feature",
      asserts: ["nm-src"],
      depends: ["nm-a", "nm-b", "nm-missing"],
      external: [{ url: "https://docs.google.com/document/d/Q/edit", label: "Questionnaire", owner: "Security" }, { url: "" }],
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.term).toBe("feature/sso");
    expect(body.missing).toEqual(["nm-missing"]);

    const g = await getDependents(org.id, { term: "feature/sso" });
    expect(g.concept?.kind).toBe("feature");
    expect(g.asserters.map((a) => a.slug)).toEqual(["nm-src"]);
    expect(g.dependents.map((d) => d.slug).sort()).toEqual(["nm-a", "nm-b"]);
    expect(g.dependents.every((d) => d.verifiedAt === null)).toBe(true);
    expect(g.external[0]).toMatchObject({ label: "Questionnaire", owner: "Security", verifiedAt: null });

    expect((await POST(post({ term: "" }))).status).toBe(400);
    resolveOrgMock.mockResolvedValue({ orgId: org.id, userId: "u2", role: "viewer" });
    expect((await POST(post({ term: "x", depends: ["nm-a"] }))).status).toBe(403);
  });
});
