import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestOrg, createTestPage } from "./helpers";

// Mock db to use test database
vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});

// validateContent is configurable per test so we can simulate the raw kazam
// CLI serde error ("invalid type: string, expected struct Page") without
// shelling out to the real binary.
const validateContentMock = vi.fn().mockResolvedValue([]);
vi.mock("@/lib/kazam", async () => {
  const actual = await vi.importActual<typeof import("@/lib/kazam")>("@/lib/kazam");
  return {
    ...actual,
    validateContent: (...args: unknown[]) => validateContentMock(...args),
    checkUnsupportedComponents: vi.fn().mockReturnValue([]),
  };
});

import { dispatch } from "@/lib/mcp-dispatch";
import { invalidContentMessage } from "@/lib/kazam";

describe("invalidContentMessage", () => {
  it("prefixes a teaching sentence and keeps the raw detail", () => {
    const msg = invalidContentMessage("invalid type: string, expected struct Page");
    expect(msg).toContain("content must be curata page YAML");
    expect(msg).toContain("get_component_reference");
    expect(msg).toContain("invalid type: string, expected struct Page");
  });
});

describe("create_page / write_page teach the YAML format on a raw parse error", () => {
  let orgId: string;
  let orgSlug: string;

  beforeEach(async () => {
    validateContentMock.mockReset();
    const org = await createTestOrg({ name: "UX Org", slug: "ux-org" });
    orgId = org.id;
    orgSlug = org.slug;
  });

  it("create_page wraps a raw kazam parse error with the teaching sentence", async () => {
    validateContentMock.mockResolvedValue([
      { file: "x.yaml", path: "", error_type: "format", message: "invalid type: string, expected struct Page" },
    ]);
    await expect(
      dispatch(
        "create_page",
        { slug: "bad-content", content: "just some prose, not yaml page content" },
        orgId,
        orgSlug,
        "apikey-1",
        "user-1"
      )
    ).rejects.toThrow(/content must be curata page YAML.*invalid type: string, expected struct Page/s);
  });

  it("write_page wraps a raw kazam parse error with the teaching sentence", async () => {
    validateContentMock.mockResolvedValue([
      { file: "x.yaml", path: "", error_type: "format", message: "invalid type: string, expected struct Page" },
    ]);
    await expect(
      dispatch(
        "write_page",
        { slug: "bad-content-write", content: "just some prose" },
        orgId,
        orgSlug,
        "apikey-1",
        "user-1"
      )
    ).rejects.toThrow(/content must be curata page YAML.*invalid type: string, expected struct Page/s);
  });
});

describe("list_rules falls back to global rules for an unknown slug", () => {
  let orgId: string;
  let orgSlug: string;
  const GLOBAL_RULES = [{ id: "no-emdash", text: "Never use em dashes.", mode: "block" as const, patterns: ["—"] }];

  beforeEach(async () => {
    validateContentMock.mockResolvedValue([]);
    const org = await createTestOrg({ name: "Rules Org", slug: "rules-org", rules: GLOBAL_RULES });
    orgId = org.id;
    orgSlug = org.slug;
  });

  it("returns global rules (not an error) and notes the slug wasn't found", async () => {
    const result = (await dispatch(
      "list_rules",
      { slug: "does-not-exist" },
      orgId,
      orgSlug,
      "apikey-1",
      "user-1"
    )) as { scope: string; rules: unknown[]; note?: string };
    expect(result.scope).toBe("global");
    expect(result.rules).toHaveLength(1);
    expect(result.note).toMatch(/does-not-exist/);
    expect(result.note).toMatch(/global/);
  });

  it("still returns page-scoped rules when the slug does exist", async () => {
    await createTestPage(orgId, { slug: "real-page" });
    const result = (await dispatch(
      "list_rules",
      { slug: "real-page" },
      orgId,
      orgSlug,
      "apikey-1",
      "user-1"
    )) as { slug?: string; note?: string };
    expect(result.slug).toBe("real-page");
    expect(result.note).toBeUndefined();
  });
});

describe("capture_thread surfaces blocking content rules", () => {
  let orgId: string;
  let orgSlug: string;

  beforeEach(async () => {
    validateContentMock.mockResolvedValue([]);
    const org = await createTestOrg({
      name: "Rules Capture Org",
      slug: "rules-capture-org",
      rules: [
        { id: "no-emdash", text: "Never use em dashes.", mode: "block" },
        { id: "flag-ai-words", text: "Review usage of these words.", mode: "warn" },
      ],
    });
    orgId = org.id;
    orgSlug = org.slug;
  });

  it("includes only block-mode rules, bounded to id/text/scope", async () => {
    const result = (await dispatch(
      "capture_thread",
      { content: "Some thread content about our product that is long enough to matter." },
      orgId,
      orgSlug,
      "apikey-1",
      "user-1"
    )) as { blockingContentRules: Array<{ id: string; text: string; scope: string }> };

    expect(result.blockingContentRules).toHaveLength(1);
    expect(result.blockingContentRules[0]).toMatchObject({ id: "no-emdash", scope: "global" });
    expect(result.blockingContentRules.map((r) => r.id)).not.toContain("flag-ai-words");
  });
});
