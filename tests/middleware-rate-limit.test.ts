import { describe, it, expect } from "vitest";
import { hashRateLimitKey } from "@/middleware";

describe("hashRateLimitKey", () => {
  it("never returns the raw input", () => {
    const auth = "Bearer sk-live-super-secret-token-value";
    expect(hashRateLimitKey(auth)).not.toContain(auth);
    expect(hashRateLimitKey(auth).length).toBeLessThan(auth.length);
  });

  it("is deterministic for the same input", () => {
    const auth = "Bearer some-token";
    expect(hashRateLimitKey(auth)).toBe(hashRateLimitKey(auth));
  });

  it("differs for different inputs", () => {
    expect(hashRateLimitKey("Bearer token-a")).not.toBe(hashRateLimitKey("Bearer token-b"));
  });
});
