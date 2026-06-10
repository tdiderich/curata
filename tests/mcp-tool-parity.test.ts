import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { ALL_TOOLS, READ_TOOLS, WRITE_TOOLS } from "@/lib/mcp-dispatch";

// The streamable-HTTP MCP server (stream/route.ts) and the plain JSON route
// (route.ts, driven by ALL_TOOLS) are two transports over the same tool set.
// They drifted once — the cleanup/lifecycle tools existed only on the plain
// route for a month. This test pins them together: every tool in the shared
// registry must be registered on the stream server.

// search_pages predates the plain route's "search" and behaves identically;
// the stream server keeps the older name rather than exposing both.
const STREAM_ALIASES: Record<string, string> = { search: "search_pages" };

function streamToolNames(): string[] {
  const src = fs.readFileSync(
    path.resolve(__dirname, "../src/app/api/mcp/stream/route.ts"),
    "utf-8"
  );
  return [...src.matchAll(/server\.tool\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
}

describe("MCP tool parity across transports", () => {
  it("registers every dispatch tool on the streamable-HTTP server", () => {
    const streamTools = new Set(streamToolNames());
    const missing = ALL_TOOLS.filter(
      (t) => !streamTools.has(STREAM_ALIASES[t] ?? t)
    );
    expect(missing, `tools on /api/mcp but not /api/mcp/stream: ${missing.join(", ")}`).toEqual([]);
  });

  it("has no duplicate registrations on the stream server", () => {
    const names = streamToolNames();
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dupes).toEqual([]);
  });

  it("keeps READ_TOOLS and WRITE_TOOLS disjoint", () => {
    const overlap = READ_TOOLS.filter((t) => WRITE_TOOLS.includes(t));
    expect(overlap).toEqual([]);
  });
});
