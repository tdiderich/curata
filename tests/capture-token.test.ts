import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createCaptureToken,
  verifyCaptureToken,
  CAPTURE_TOKEN_TTL_MS,
  isCaptureTokenConsumed,
  consumeCaptureToken,
} from "@/lib/capture-token";

describe("capture token round-trip", () => {
  it("verifies a freshly minted token for its own org, with or without the content it was minted for", () => {
    const token = createCaptureToken("org-1", "the customer asked about pricing tiers");
    expect(verifyCaptureToken(token, "org-1")).toEqual({ ok: true });
    expect(verifyCaptureToken(token, "org-1", "the customer asked about pricing tiers")).toEqual({ ok: true });
  });

  it("rejects a missing token", () => {
    const result = verifyCaptureToken(undefined, "org-1");
    expect(result.ok).toBe(false);
  });

  it("rejects a malformed token", () => {
    expect(verifyCaptureToken("not-a-real-token", "org-1").ok).toBe(false);
    expect(verifyCaptureToken("payload-only-no-signature", "org-1").ok).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const token = createCaptureToken("org-1", "some content");
    const [payload] = token.split(".");
    const tampered = `${payload}.0000000000000000000000000000000000000000000000000000000000000000`;
    const result = verifyCaptureToken(tampered, "org-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("invalid capture_token");
  });

  it("rejects a token minted for a different organization", () => {
    const token = createCaptureToken("org-1", "some content");
    const result = verifyCaptureToken(token, "org-2");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("different organization");
  });

  it("rejects a token checked against content it wasn't minted for", () => {
    const token = createCaptureToken("org-1", "content A");
    const result = verifyCaptureToken(token, "org-1", "content B");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("does not match");
  });

  it("rejects an expired token", () => {
    const token = createCaptureToken("org-1", "some content", -1);
    const result = verifyCaptureToken(token, "org-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("expired");
  });

  it("defaults to a 15 minute TTL", () => {
    expect(CAPTURE_TOKEN_TTL_MS).toBe(15 * 60 * 1000);
  });
});

describe("capture token single-use", () => {
  it("is not consumed until consumeCaptureToken is called", () => {
    const token = createCaptureToken("org-1", "some content");
    expect(isCaptureTokenConsumed(token)).toBe(false);
  });

  it("reports consumed after consumeCaptureToken", () => {
    const token = createCaptureToken("org-1", "some content");
    consumeCaptureToken(token);
    expect(isCaptureTokenConsumed(token)).toBe(true);
  });

  it("expires the consumed marker after its own ttl", () => {
    const token = createCaptureToken("org-1", "some content");
    consumeCaptureToken(token, -1);
    expect(isCaptureTokenConsumed(token)).toBe(false);
  });
});

describe("capture token signing secret — fail-closed in production clerk mode", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("throws when AUTH_MODE=clerk and NODE_ENV=production with no explicit secret", async () => {
    vi.stubEnv("AUTH_MODE", "clerk");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CAPTURE_TOKEN_SECRET", "");
    vi.stubEnv("NEXTAUTH_SECRET", "");
    vi.stubEnv("DATABASE_URL", "postgresql://fallback-should-not-be-used");
    vi.resetModules();

    const { createCaptureToken: createFresh } = await import("@/lib/capture-token");
    expect(() => createFresh("org-1", "content")).toThrow(/CAPTURE_TOKEN_SECRET/);
  });

  it("works when AUTH_MODE=clerk and NODE_ENV=production with CAPTURE_TOKEN_SECRET set", async () => {
    vi.stubEnv("AUTH_MODE", "clerk");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CAPTURE_TOKEN_SECRET", "a-real-secret");
    vi.resetModules();

    const { createCaptureToken: createFresh, verifyCaptureToken: verifyFresh } = await import("@/lib/capture-token");
    const token = createFresh("org-1", "content");
    expect(verifyFresh(token, "org-1")).toEqual({ ok: true });
  });

  it("still falls back to DATABASE_URL outside of production clerk mode", async () => {
    vi.stubEnv("AUTH_MODE", "none");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CAPTURE_TOKEN_SECRET", "");
    vi.stubEnv("NEXTAUTH_SECRET", "");
    vi.stubEnv("DATABASE_URL", "postgresql://fallback-ok-here");
    vi.resetModules();

    const { createCaptureToken: createFresh, verifyCaptureToken: verifyFresh } = await import("@/lib/capture-token");
    const token = createFresh("org-1", "content");
    expect(verifyFresh(token, "org-1")).toEqual({ ok: true });
  });
});
