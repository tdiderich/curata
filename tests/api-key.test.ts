import { describe, it, expect } from "vitest";
import { generateApiKey, hashApiKey } from "@/lib/api-key";

describe("api-key", () => {
  it("generateApiKey returns key with ck_ prefix", () => {
    const { key } = generateApiKey();
    expect(key).toMatch(/^ck_/);
  });

  it("generateApiKey returns an 8-char prefix", () => {
    const { prefix } = generateApiKey();
    expect(prefix).toHaveLength(8);
  });

  it("generateApiKey returns a hex hash", () => {
    const { hash } = generateApiKey();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashApiKey produces consistent SHA-256 hashes", () => {
    const key = "ck_somekey";
    const h1 = hashApiKey(key);
    const h2 = hashApiKey(key);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("different keys produce different hashes", () => {
    const h1 = hashApiKey("ck_key_one");
    const h2 = hashApiKey("ck_key_two");
    expect(h1).not.toBe(h2);
  });
});
