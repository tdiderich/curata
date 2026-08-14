import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { testDb } from "./setup";
import { createTestOrg, createTestPage } from "./helpers";

// Mock db to use test database
vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});

// resolveOrg is swapped per-test to simulate whichever user/role is "logged in".
const resolveOrgMock = vi.fn();
vi.mock("@/lib/auth", () => ({ resolveOrg: () => resolveOrgMock() }));

import { POST, DELETE } from "@/app/api/versions/trust/route";

function trustRequest(method: "POST" | "DELETE", body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/versions/trust", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST/DELETE /api/versions/trust — approval-eligibility enforcement", () => {
  let orgId: string;
  let versionId: string;

  beforeEach(async () => {
    const org = await createTestOrg({ name: "Trust Route Org", slug: "trust-route-org" });
    orgId = org.id;
    const group = await testDb.group.create({ data: { orgId, name: "Test", slug: "test" } });
    const page = await createTestPage(orgId, {
      slug: "gated-page",
      rules: [{ id: "approval", kind: "approval", approvers: [{ type: "group", id: group.id }] }],
    });
    versionId = page.versions[0].id;
  });

  it("403s an editor who isn't in the approval rule's group", async () => {
    resolveOrgMock.mockResolvedValue({ orgId, orgSlug: "trust-route-org", userId: "outsider", role: "member" });

    const res = await POST(trustRequest("POST", { slug: "gated-page", versionId }));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("approval limited to: Test");

    const page = await testDb.page.findUnique({ where: { orgId_slug: { orgId, slug: "gated-page" } } });
    expect(page?.trustedVersionId).toBeNull();
  });

  it("allows a member who is in the approval rule's group", async () => {
    await testDb.orgMember.create({ data: { orgId, userId: "insider", role: "member" } });
    const group = await testDb.group.findFirstOrThrow({ where: { orgId, name: "Test" } });
    await testDb.groupMember.create({ data: { groupId: group.id, userId: "insider", role: "member" } });
    resolveOrgMock.mockResolvedValue({ orgId, orgSlug: "trust-route-org", userId: "insider", role: "member" });

    const res = await POST(trustRequest("POST", { slug: "gated-page", versionId }));
    expect(res.status).toBe(200);

    const page = await testDb.page.findUnique({ where: { orgId_slug: { orgId, slug: "gated-page" } } });
    expect(page?.trustedVersionId).toBe(versionId);
  });

  it("org owners bypass the approval rule (escape hatch)", async () => {
    resolveOrgMock.mockResolvedValue({ orgId, orgSlug: "trust-route-org", userId: "the-owner", role: "owner" });

    const res = await POST(trustRequest("POST", { slug: "gated-page", versionId }));
    expect(res.status).toBe(200);
  });

  it("DELETE (clear trusted) is gated the same way", async () => {
    await testDb.page.update({ where: { orgId_slug: { orgId, slug: "gated-page" } }, data: { trustedVersionId: versionId } });
    resolveOrgMock.mockResolvedValue({ orgId, orgSlug: "trust-route-org", userId: "outsider", role: "member" });

    const res = await DELETE(trustRequest("DELETE", { slug: "gated-page" }));
    expect(res.status).toBe(403);

    const page = await testDb.page.findUnique({ where: { orgId_slug: { orgId, slug: "gated-page" } } });
    expect(page?.trustedVersionId).toBe(versionId);
  });

  it("still 403s a viewer regardless of approval-rule membership (page:edit floor unchanged)", async () => {
    resolveOrgMock.mockResolvedValue({ orgId, orgSlug: "trust-route-org", userId: "some-viewer", role: "viewer" });
    const res = await POST(trustRequest("POST", { slug: "gated-page", versionId }));
    expect(res.status).toBe(403);
  });
});
