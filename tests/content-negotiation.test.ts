import { describe, expect, it } from "vitest";
import { negotiateTarget, preferredType } from "@/lib/content-negotiation";

describe("preferredType", () => {
  it("returns 0 when the header is absent", () => {
    expect(preferredType(null, ["text/markdown"])).toBe(0);
  });

  it("ignores wildcards so plain HTTP clients keep getting HTML", () => {
    expect(preferredType("*/*", ["text/markdown"])).toBe(0);
    expect(preferredType("text/*", ["text/markdown"])).toBe(0);
  });

  it("reads q-values", () => {
    expect(preferredType("text/markdown;q=0.4", ["text/markdown"])).toBe(0.4);
    expect(preferredType("text/markdown", ["text/markdown"])).toBe(1);
  });

  it("takes the highest matching q-value", () => {
    expect(
      preferredType("text/markdown;q=0.3, text/x-markdown;q=0.9", [
        "text/markdown",
        "text/x-markdown",
      ]),
    ).toBe(0.9);
  });
});

describe("negotiateTarget", () => {
  const page = "/p/acme/roadmap";

  it("leaves non-page paths alone", () => {
    expect(negotiateTarget("/dashboard", "text/markdown")).toBeNull();
    expect(negotiateTarget("/p/acme", "text/markdown")).toBeNull();
    expect(negotiateTarget("/p/acme/roadmap/raw", "text/markdown")).toBeNull();
  });

  it("serves HTML by default", () => {
    expect(negotiateTarget(page, null)).toBeNull();
    expect(negotiateTarget(page, "*/*")).toBeNull();
    expect(
      negotiateTarget(page, "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"),
    ).toBeNull();
  });

  it("routes an Accept: text/markdown request to the markdown route", () => {
    expect(negotiateTarget(page, "text/markdown")).toBe("/p/acme/roadmap/md");
  });

  it("routes an Accept: application/yaml request to the raw route", () => {
    expect(negotiateTarget(page, "application/yaml")).toBe("/p/acme/roadmap/raw");
    expect(negotiateTarget(page, "text/yaml")).toBe("/p/acme/roadmap/raw");
  });

  it("honours q-values when a client accepts both HTML and markdown", () => {
    expect(negotiateTarget(page, "text/html;q=0.9, text/markdown;q=1.0")).toBe(
      "/p/acme/roadmap/md",
    );
    expect(negotiateTarget(page, "text/html, text/markdown;q=0.5")).toBeNull();
  });

  it("prefers markdown over yaml when both are equally acceptable", () => {
    expect(negotiateTarget(page, "text/markdown, application/yaml")).toBe("/p/acme/roadmap/md");
    expect(negotiateTarget(page, "text/markdown;q=0.2, application/yaml;q=0.9")).toBe(
      "/p/acme/roadmap/raw",
    );
  });

  it("maps suffixes, which win over the Accept header", () => {
    expect(negotiateTarget("/p/acme/roadmap.md", "text/html")).toBe("/p/acme/roadmap/md");
    expect(negotiateTarget("/p/acme/roadmap.markdown", null)).toBe("/p/acme/roadmap/md");
    expect(negotiateTarget("/p/acme/roadmap.yaml", "text/html")).toBe("/p/acme/roadmap/raw");
    expect(negotiateTarget("/p/acme/roadmap.yml", null)).toBe("/p/acme/roadmap/raw");
  });

  it("keeps dots that are part of the slug", () => {
    expect(negotiateTarget("/p/acme/v1.2-notes", null)).toBeNull();
    expect(negotiateTarget("/p/acme/v1.2-notes.md", null)).toBe("/p/acme/v1.2-notes/md");
  });
});
