import { describe, it, expect } from "vitest";
import { buildActivitySessions, type ActivityRow } from "@/lib/activity";

function row(overrides: Partial<ActivityRow>): ActivityRow {
  return {
    id: "row-1",
    action: "page.write",
    resourceType: "page",
    resourceId: "res-1",
    actorType: "apikey",
    actorId: "_ZdcUBAJ",
    metadata: { slug: "roadmap" },
    createdAt: new Date(),
    ...overrides,
  };
}

const pagesBySlug = new Map([["roadmap", "Roadmap"]]);

describe("buildActivitySessions apikey actor labels", () => {
  it("resolves an apikey actor to the key's name when a name map is supplied", () => {
    const rows = [row({ id: "r1" })];
    const names = new Map([["_ZdcUBAJ", "Deploy Bot"]]);
    const [entry] = buildActivitySessions(rows, pagesBySlug, names);
    expect(entry.actorLabel).toBe("Deploy Bot");
  });

  it("falls back to the raw actorId when the key isn't in the name map (revoked/deleted)", () => {
    const rows = [row({ id: "r1", actorId: "_gone1234" })];
    const names = new Map([["_ZdcUBAJ", "Deploy Bot"]]);
    const [entry] = buildActivitySessions(rows, pagesBySlug, names);
    expect(entry.actorLabel).toBe("_gone1234");
  });

  it("falls back to the raw actorId when no name map is supplied at all", () => {
    const rows = [row({ id: "r1" })];
    const [entry] = buildActivitySessions(rows, pagesBySlug);
    expect(entry.actorLabel).toBe("_ZdcUBAJ");
  });

  it("still strips the ts: prefix for non-apikey actors regardless of the name map", () => {
    const rows = [row({ id: "r1", actorType: "user", actorId: "ts:alice@example.com" })];
    const names = new Map([["ts:alice@example.com", "should not be used"]]);
    const [entry] = buildActivitySessions(rows, pagesBySlug, names);
    expect(entry.actorLabel).toBe("alice@example.com");
  });
});
