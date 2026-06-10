import { describe, it, expect } from "vitest";
import { formatRefreshAge, STALE_AFTER_HOURS } from "@/lib/home-glance";

describe("formatRefreshAge", () => {
  const now = new Date("2026-06-10T12:00:00Z");

  it("reports 'just now' under an hour and is not stale", () => {
    const r = formatRefreshAge(new Date("2026-06-10T11:30:00Z"), now);
    expect(r).toEqual({ label: "just now", stale: false });
  });

  it("reports hours under a day", () => {
    const r = formatRefreshAge(new Date("2026-06-10T05:00:00Z"), now);
    expect(r).toEqual({ label: "7h ago", stale: false });
  });

  it("reports days at and beyond 24h", () => {
    const r = formatRefreshAge(new Date("2026-06-08T11:00:00Z"), now);
    expect(r).toEqual({ label: "2d ago", stale: false });
  });

  it("flags stale strictly past 72h", () => {
    const exactly72 = formatRefreshAge(new Date("2026-06-07T12:00:00Z"), now);
    expect(exactly72.stale).toBe(false);
    const past72 = formatRefreshAge(new Date("2026-06-07T11:59:00Z"), now);
    expect(past72).toEqual({ label: "3d ago", stale: true });
  });

  it("exports the 72h threshold", () => {
    expect(STALE_AFTER_HOURS).toBe(72);
  });
});
