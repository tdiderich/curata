import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import path from "path";
import yaml from "js-yaml";
import { STARTER_PROMPT } from "@/lib/starter-prompt";
import {
  matchRoute,
  resolveHelpVideo,
  shouldNudge,
  NUDGE_MAX_DISMISSALS,
  NUDGE_MAX_SESSIONS,
  type HelpManifest,
} from "@/lib/help-videos";

const manifest: HelpManifest = {
  welcome: "welcome",
  videos: [
    { id: "welcome", title: "Welcome", src: "/help/welcome.mp4" },
    { id: "page", title: "Page", src: "/help/page.mp4" },
  ],
  routes: [
    { match: "/dashboard", video: "welcome", nudge: true },
    { match: "/pages/*", video: "page" },
  ],
};

const fresh = { sessions: 1, dismissals: 0, nudgedPaths: [] as string[] };

describe("help video routing", () => {
  it("matches exact paths and prefix wildcards", () => {
    expect(matchRoute("/dashboard", manifest.routes)?.video).toBe("welcome");
    expect(matchRoute("/pages/acme-tsp", manifest.routes)?.video).toBe("page");
    expect(matchRoute("/dashboard/extra", manifest.routes)).toBeNull();
  });

  it("matches one segment for an inner * and checks routes in order", () => {
    const routes = [
      { match: "/pages/*/settings", video: "page-settings" },
      { match: "/pages/*", video: "page" },
    ];
    expect(matchRoute("/pages/acme/settings", routes)?.video).toBe("page-settings");
    expect(matchRoute("/pages/acme", routes)?.video).toBe("page");
    expect(matchRoute("/pages/a/b/settings", routes)?.video).toBe("page");
  });

  it("falls back to the welcome video for unmatched routes", () => {
    expect(resolveHelpVideo("/map", manifest)?.id).toBe("welcome");
  });

  it("falls back to welcome when a route names a missing video", () => {
    const m = { ...manifest, routes: [{ match: "/x", video: "gone" }] };
    expect(resolveHelpVideo("/x", m)?.id).toBe("welcome");
  });
});

describe("idle nudge caps", () => {
  it("nudges only on opted-in routes", () => {
    expect(shouldNudge("/dashboard", manifest, fresh)).toBe(true);
    expect(shouldNudge("/pages/acme", manifest, fresh)).toBe(false);
  });

  it("nudges each path once per session", () => {
    expect(shouldNudge("/dashboard", manifest, { ...fresh, nudgedPaths: ["/dashboard"] })).toBe(false);
  });

  it("stops after the session and dismissal caps", () => {
    expect(shouldNudge("/dashboard", manifest, { ...fresh, sessions: NUDGE_MAX_SESSIONS + 1 })).toBe(false);
    expect(shouldNudge("/dashboard", manifest, { ...fresh, dismissals: NUDGE_MAX_DISMISSALS })).toBe(false);
  });
});

describe("shipped manifest", () => {
  const shipped = JSON.parse(
    readFileSync(path.join(process.cwd(), "public", "help", "videos.json"), "utf8"),
  ) as HelpManifest;

  it("every docs link points at a seeded docs page", () => {
    const seeded = new Set(
      ["getting-started", "workflows", "templates"].flatMap((d) =>
        readdirSync(path.join(process.cwd(), "seed", d)).map((f) => f.replace(/\.ya?ml$/, "")),
      ),
    );
    for (const v of shipped.videos) {
      expect(v.actions?.length, `${v.id} needs a copy action and a docs link`).toBeGreaterThanOrEqual(2);
      for (const a of v.actions ?? []) {
        if (a.kind === "link") expect(seeded.has(a.href!.replace("/pages/", "")), a.href).toBe(true);
      }
    }
  });

  it("routes every app screen to its own video", () => {
    const want: Record<string, string> = {
      "/dashboard": "welcome",
      "/pages/x": "page",
      "/pages/x/settings": "page-settings",
      "/map": "map",
      "/map/new": "map-new",
      "/map/pricing": "map-node",
      "/review": "review",
      "/cleanup": "cleanup",
      "/settings": "settings",
    };
    for (const [p, id] of Object.entries(want)) expect(resolveHelpVideo(p, shipped)?.id, p).toBe(id);
  });

  it("every copy-prompt action carries a prompt", () => {
    for (const v of shipped.videos) for (const a of v.actions ?? []) {
      if (a.kind === "copy-prompt") expect(a.prompt?.length, `${v.id}: ${a.label}`).toBeGreaterThan(40);
    }
  });

  it("every route and the welcome id point at a defined video", () => {
    const ids = new Set(shipped.videos.map((v) => v.id));
    expect(ids.has(shipped.welcome)).toBe(true);
    for (const r of shipped.routes) expect(ids.has(r.video)).toBe(true);
  });
});

describe("welcome video", () => {
  it("types the same starter prompt the connect modal offers to copy", () => {
    const beats = yaml.load(
      readFileSync(path.join(process.cwd(), "scripts", "help-videos", "welcome.beats.yaml"), "utf8"),
    ) as { beats: Array<{ id: string; terminal?: { typed: string } }> };
    const setup = beats.beats.find((b) => b.id === "setup");
    expect(setup?.terminal?.typed).toBe(STARTER_PROMPT);
  });
});
