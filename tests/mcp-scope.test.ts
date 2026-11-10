import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { testDb } from "./setup";
import { createTestOrg, createTestPage, createTestApiKey } from "./helpers";

vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});

// No filesystem/browser side effects from page writes.
vi.mock("@/lib/kazam", async (importOriginal) => {
  const os = await import("os");
  const path = await import("path");
  const tmpDir = path.join(os.tmpdir(), `curata-test-mcp-scope-${process.pid}`);
  return {
    ...(await importOriginal<typeof import("@/lib/kazam")>()),
    sitePath: () => tmpDir,
    buildSite: vi.fn().mockResolvedValue(""),
    validateContent: vi.fn().mockResolvedValue([]),
    validateContentSplit: vi.fn().mockResolvedValue({ errors: [], warnings: [] }),
    checkUnsupportedComponents: vi.fn().mockReturnValue([]),
  };
});

import { deniedToolCall, toolAllowedForScopes, READ_TOOLS, WRITE_TOOLS } from "@/lib/mcp-dispatch";
import { POST as streamPOST } from "@/app/api/mcp/stream/route";
import { POST as plainPOST } from "@/app/api/mcp/route";

const READ = ["read"];
const RW = ["read", "write"];

describe("toolAllowedForScopes / deniedToolCall", () => {
  it("lets read-only callers call read tools, including the search_pages alias", () => {
    for (const t of READ_TOOLS) expect(toolAllowedForScopes(t, READ)).toBe(true);
    expect(toolAllowedForScopes("search_pages", READ)).toBe(true);
  });

  it("denies read-only callers every write tool", () => {
    for (const t of WRITE_TOOLS) expect(toolAllowedForScopes(t, READ)).toBe(false);
  });

  it("fails closed for stream-only and unknown tools", () => {
    expect(toolAllowedForScopes("restore_page_version", READ)).toBe(false);
    expect(toolAllowedForScopes("replace_in_page", READ)).toBe(false);
    expect(toolAllowedForScopes("some_future_tool", READ)).toBe(false);
    expect(toolAllowedForScopes("", READ)).toBe(false);
  });

  it("allows everything with write scope", () => {
    expect(toolAllowedForScopes("write_page", RW)).toBe(true);
    expect(deniedToolCall({ method: "tools/call", id: 1, params: { name: "write_page" } }, RW)).toBeNull();
  });

  it("finds a denied call in a single message or a batch, and ignores non-call methods", () => {
    expect(deniedToolCall({ method: "tools/call", id: 7, params: { name: "write_page" } }, READ))
      .toEqual({ id: 7, tool: "write_page" });
    expect(deniedToolCall([
      { method: "tools/call", id: 1, params: { name: "read_page" } },
      { method: "tools/call", id: "b", params: { name: "create_folder" } },
    ], READ)).toEqual({ id: "b", tool: "create_folder" });
    expect(deniedToolCall({ method: "tools/list", id: 1 }, READ)).toBeNull();
    expect(deniedToolCall({ method: "initialize", id: 1, params: {} }, READ)).toBeNull();
    expect(deniedToolCall({ method: "tools/call", id: 2, params: { name: "read_page" } }, READ)).toBeNull();
  });
});

function rpc(url: string, key: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
}

const WRITE_CALL = {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: { name: "write_page", arguments: { slug: "scope-new", yaml: "title: Nope\nshell: document\ncomponents: []\n" } },
};

describe("POST /api/mcp/stream scope enforcement", () => {
  // API-key auth applies in every mode except none/tailscale.
  beforeEach(() => vi.stubEnv("AUTH_MODE", "oauth"));
  afterEach(() => vi.unstubAllEnvs());

  it("rejects a write tool for a read-only API key before it runs", async () => {
    const org = await createTestOrg({ slug: "scope-org" });
    const { key } = await createTestApiKey(org.id, { scopes: ["read"] });

    const res = await streamPOST(rpc("http://localhost/api/mcp/stream", key, WRITE_CALL));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.id).toBe(1);
    expect(body.error.message).toContain("insufficient scope");
    expect(await testDb.page.findFirst({ where: { orgId: org.id, slug: "scope-new" } })).toBeNull();
  });

  it("rejects stream-only write tools for a read-only key", async () => {
    const org = await createTestOrg({ slug: "scope-org" });
    await createTestPage(org.id, { slug: "scope-page" });
    const { key } = await createTestApiKey(org.id, { scopes: ["read"] });

    const res = await streamPOST(rpc("http://localhost/api/mcp/stream", key, {
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "replace_in_page", arguments: { slug: "scope-page", target: "Test", replacement: "Pwned" } },
    }));
    expect(res.status).toBe(403);
  });

  it("lets a read-only key call read tools", async () => {
    const org = await createTestOrg({ slug: "scope-org" });
    await createTestPage(org.id, { slug: "scope-page" });
    const { key } = await createTestApiKey(org.id, { scopes: ["read"] });

    const res = await streamPOST(rpc("http://localhost/api/mcp/stream", key, {
      jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_folders", arguments: {} },
    }));
    expect(res.status).toBe(200);
  });

  it("lets a read/write key through to the write tool", async () => {
    const org = await createTestOrg({ slug: "scope-org" });
    const { key } = await createTestApiKey(org.id, { scopes: ["read", "write"] });

    const res = await streamPOST(rpc("http://localhost/api/mcp/stream", key, WRITE_CALL));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/mcp scope enforcement", () => {
  beforeEach(() => vi.stubEnv("AUTH_MODE", "oauth"));
  afterEach(() => vi.unstubAllEnvs());

  it("rejects a write tool for a read-only API key", async () => {
    const org = await createTestOrg({ slug: "scope-org" });
    const { key } = await createTestApiKey(org.id, { scopes: ["read"] });

    const res = await plainPOST(new NextRequest(rpc("http://localhost/api/mcp", key, {
      tool: "write_page", args: { slug: "scope-new", yaml: "title: Nope\n" },
    })));
    expect(res.status).toBe(403);
  });
});
