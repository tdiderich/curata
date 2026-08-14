import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createExportNonce,
  verifyExportNonceSignature,
  consumeExportNonce,
} from "@/lib/export-nonce";

describe("export nonce round-trip", () => {
  it("mints a nonce that verifies and consumes for its org/slug", async () => {
    const nonce = await createExportNonce("org-1", "my-slug");
    expect(await verifyExportNonceSignature(nonce)).toBe(true);
    const consumed = await consumeExportNonce(nonce);
    expect(consumed).toEqual({ orgId: "org-1", slug: "my-slug", hub: undefined });
  });

  it("is single-use — a second consume returns null", async () => {
    const nonce = await createExportNonce("org-1", "my-slug");
    expect(await consumeExportNonce(nonce)).not.toBeNull();
    expect(await consumeExportNonce(nonce)).toBeNull();
  });

  it("carries the hub slug when the render path supplies one", async () => {
    const nonce = await createExportNonce("org-1", "my-slug", "hub-slug");
    const consumed = await consumeExportNonce(nonce);
    expect(consumed?.hub).toBe("hub-slug");
  });

  it("rejects a tampered nonce", async () => {
    const nonce = await createExportNonce("org-1", "my-slug");
    const [id, expires] = nonce.split(".");
    const tampered = `${id}.${expires}.0000000000000000000000000000000000000000000000000000000000000000`;
    expect(await verifyExportNonceSignature(tampered)).toBe(false);
    expect(await consumeExportNonce(tampered)).toBeNull();
  });
});

describe("export nonce signing secret — fail-closed in production clerk mode", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("throws when AUTH_MODE=clerk and NODE_ENV=production with no explicit secret", async () => {
    vi.stubEnv("AUTH_MODE", "clerk");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EXPORT_SECRET", "");
    vi.stubEnv("NEXTAUTH_SECRET", "");
    vi.stubEnv("DATABASE_URL", "postgresql://fallback-should-not-be-used");
    vi.resetModules();

    const { createExportNonce: createFresh } = await import("@/lib/export-nonce");
    await expect(createFresh("org-1", "my-slug")).rejects.toThrow(/EXPORT_SECRET/);
  });

  it("works when AUTH_MODE=clerk and NODE_ENV=production with EXPORT_SECRET set", async () => {
    vi.stubEnv("AUTH_MODE", "clerk");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EXPORT_SECRET", "a-real-secret");
    vi.resetModules();

    const { createExportNonce: createFresh, verifyExportNonceSignature: verifyFresh } = await import("@/lib/export-nonce");
    const nonce = await createFresh("org-1", "my-slug");
    expect(await verifyFresh(nonce)).toBe(true);
  });

  it("still falls back to DATABASE_URL outside of production clerk mode", async () => {
    vi.stubEnv("AUTH_MODE", "none");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("EXPORT_SECRET", "");
    vi.stubEnv("NEXTAUTH_SECRET", "");
    vi.stubEnv("DATABASE_URL", "postgresql://fallback-ok-here");
    vi.resetModules();

    const { createExportNonce: createFresh, verifyExportNonceSignature: verifyFresh } = await import("@/lib/export-nonce");
    const nonce = await createFresh("org-1", "my-slug");
    expect(await verifyFresh(nonce)).toBe(true);
  });
});
