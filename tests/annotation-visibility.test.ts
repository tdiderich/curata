import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { testDb } from "./setup";
import { createTestOrg, createTestPage, createTestAnnotation } from "./helpers";

vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});
const resolveOrgMock = vi.fn();
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  resolveOrg: () => resolveOrgMock(),
  resolveCurrentUser: async () => ({ id: "u1", email: "u1@example.com", name: "U One" }),
}));

import { getAnnotations, getPublicAnnotations, isAnnotationVisibility } from "@/lib/pages";
import { POST as annotationsPOST } from "@/app/api/annotations/route";
import { POST as publicAnnotationsPOST } from "@/app/api/public-annotations/route";
import { authModeStartupWarning } from "@/lib/auth-mode-check";

describe("presenter-only annotations", () => {
  it("are left out of the public annotation query but kept for the authenticated one", async () => {
    const org = await createTestOrg({ slug: "ann-org" });
    const page = await createTestPage(org.id, { slug: "ann-page", visibility: "public" });
    await createTestAnnotation(page.id, { text: "everyone sees this" });
    await createTestAnnotation(page.id, { text: "explicitly visible", visibility: "visible" });
    await createTestAnnotation(page.id, { text: "speaker notes only", visibility: "presenter" });

    const pub = (await getPublicAnnotations(org.id, "ann-page")).map((a) => a.text);
    expect(pub).toEqual(["everyone sees this", "explicitly visible"]);

    const all = (await getAnnotations(org.id, "ann-page")).map((a) => a.text);
    expect(all).toContain("speaker notes only");
  });

  it("returns nothing for a missing page", async () => {
    const org = await createTestOrg({ slug: "ann-org" });
    expect(await getPublicAnnotations(org.id, "nope")).toEqual([]);
  });
});

describe("annotation visibility validation", () => {
  it("accepts only the known values", () => {
    expect(isAnnotationVisibility("visible")).toBe(true);
    expect(isAnnotationVisibility("presenter")).toBe(true);
    expect(isAnnotationVisibility("admins-only")).toBe(false);
    expect(isAnnotationVisibility(1)).toBe(false);
  });

  it("rejects an unknown visibility on POST /api/annotations", async () => {
    const org = await createTestOrg({ slug: "ann-org" });
    await createTestPage(org.id, { slug: "ann-page" });
    resolveOrgMock.mockResolvedValue({ orgId: org.id, orgSlug: org.slug, userId: "u1", role: "owner" });

    const res = await annotationsPOST(new NextRequest("http://localhost/api/annotations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: "ann-page", text: "hi", visibility: "admins-only" }),
    }));
    expect(res.status).toBe(400);
    expect(await testDb.annotation.count()).toBe(0);

    const ok = await annotationsPOST(new NextRequest("http://localhost/api/annotations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: "ann-page", text: "hi", visibility: "presenter" }),
    }));
    expect(ok.status).toBe(201);
  });

  it("rejects an unknown visibility on POST /api/public-annotations", async () => {
    const org = await createTestOrg({ slug: "ann-org" });
    await createTestPage(org.id, { slug: "ann-page", visibility: "public" });

    const res = await publicAnnotationsPOST(new NextRequest("http://localhost/api/public-annotations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgSlug: "ann-org", pageSlug: "ann-page", text: "hi", visibility: "admins-only" }),
    }));
    expect(res.status).toBe(400);
    expect(await testDb.annotation.count()).toBe(0);
  });
});

describe("authModeStartupWarning", () => {
  it("warns only for a production build with AUTH_MODE unset", () => {
    expect(authModeStartupWarning({ NODE_ENV: "production" })).toContain("AUTH_MODE is not set");
    expect(authModeStartupWarning({ NODE_ENV: "production", AUTH_MODE: "" })).toContain("AUTH_MODE is not set");
    expect(authModeStartupWarning({ NODE_ENV: "production", AUTH_MODE: "none" })).toBeNull();
    expect(authModeStartupWarning({ NODE_ENV: "production", AUTH_MODE: "clerk" })).toBeNull();
    expect(authModeStartupWarning({ NODE_ENV: "development" })).toBeNull();
  });
});
