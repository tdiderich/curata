import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { testDb } from "./setup";
import { createTestOrg, createTestApiKey } from "./helpers";

vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});
const resolveOrgMock = vi.fn();
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  resolveOrg: () => resolveOrgMock(),
}));

import { DELETE } from "@/app/api/members/route";
import { resolveOrgFromApiKey } from "@/lib/auth";

function del(memberId: string): NextRequest {
  return new NextRequest("http://localhost/api/members", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ memberId }),
  });
}

describe("DELETE /api/members", () => {
  it("revokes the removed member's API keys so they stop authenticating", async () => {
    const org = await createTestOrg({ slug: "rm-org" });
    const other = await createTestOrg({ slug: "rm-other", name: "Other" });
    await testDb.orgMember.create({ data: { orgId: org.id, userId: "boss", role: "owner" } });
    resolveOrgMock.mockResolvedValue({ orgId: org.id, orgSlug: org.slug, userId: "boss", role: "owner" });

    const { key: leaverKey } = await createTestApiKey(org.id, { createdBy: "leaver" });
    const { key: leaverKey2 } = await createTestApiKey(org.id, { createdBy: "leaver", scopes: ["read"] });
    const { key: stayerKey } = await createTestApiKey(org.id, { createdBy: "stayer" });
    // Same user, different org: their membership there is untouched.
    const { key: otherOrgKey } = await createTestApiKey(other.id, { createdBy: "leaver" });

    expect(await resolveOrgFromApiKey(leaverKey)).not.toBeNull();

    const member = await testDb.orgMember.findUniqueOrThrow({
      where: { orgId_userId: { orgId: org.id, userId: "leaver" } },
    });
    const res = await DELETE(del(member.id));
    expect(res.status).toBe(200);

    expect(await resolveOrgFromApiKey(leaverKey)).toBeNull();
    expect(await resolveOrgFromApiKey(leaverKey2)).toBeNull();
    expect(await resolveOrgFromApiKey(stayerKey)).not.toBeNull();
    expect(await resolveOrgFromApiKey(otherOrgKey)).not.toBeNull();

    const revoked = await testDb.apiKey.findMany({ where: { orgId: org.id, createdBy: "leaver" } });
    expect(revoked.every((k) => k.revokedAt !== null)).toBe(true);
  });
});
