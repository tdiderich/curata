import { describe, it, expect, vi } from "vitest";
import { createTestOrg, createTestPage } from "./helpers";

vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});
vi.mock("@/lib/kazam", () => ({ validateYaml: async () => ({ valid: true, errors: [] }), hasSchemaFor: () => false, getBaseKazamSchema: () => null }));

import { testDb } from "./setup";
import { lineDiff, readVersion } from "@/lib/versions";
import { writePage } from "@/lib/pages";
import { applyPatchOperations } from "@/lib/component-ids";

describe("read_version", () => {
  it("diffs lines and reads a version by id, latest, or previous", () => {
    const d = lineDiff("a\nb\nc", "a\nc\nd");
    expect(d).toEqual({ added: ["d"], removed: ["b"], unchanged: 2 });
  });

  it("returns content, author, position, and the diff to another version", async () => {
    const org = await createTestOrg({ name: "Ver Org", slug: "ver-org" });
    await createTestPage(org.id, { slug: "ver-page", yamlContent: "title: V\ncomponents:\n  - type: markdown\n    id: m\n    body: price $69\n" });
    const cur = await readVersion(org.id, "ver-page", "latest");
    const res = await writePage(org.id, org.slug, "ver-page", "title: V\ncomponents:\n  - type: markdown\n    id: m\n    body: price $79\n", "agent", cur.contentHash);
    expect(res.ok).toBe(true);
    const latest = await readVersion(org.id, "ver-page", "latest", "previous");
    expect(latest.index).toBe(2);
    expect(latest.total).toBe(2);
    expect(latest.createdBy).toBe("agent");
    expect(latest.yaml).toContain("$79");
    expect(latest.diff?.added.some((l) => l.includes("$79"))).toBe(true);
    expect(latest.diff?.removed.some((l) => l.includes("$69"))).toBe(true);
    const prev = await readVersion(org.id, "ver-page", "previous");
    expect(prev.yaml).toContain("$69");
    const byId = await readVersion(org.id, "ver-page", prev.versionId);
    expect(byId.contentHash).toBe(prev.contentHash);
    await expect(readVersion(org.id, "ver-page", "nope")).rejects.toThrow(/version not found: nope/);
    expect(await testDb.pageVersion.count()).toBeGreaterThan(0);
  });

  it("patch errors carry the ops cheat sheet", () => {
    const page = { title: "x", components: [{ type: "markdown", id: "m", body: "hi" }] };
    expect(() => applyPatchOperations(page, [{ op: "replace", id: "m" } as never])).toThrow(/patch_page operations:[\s\S]*Example:/);
    expect(() => applyPatchOperations(page, [{ op: "bogus" } as never])).toThrow(/Unknown op[\s\S]*set_field \(field, value\)/);
  });
});
