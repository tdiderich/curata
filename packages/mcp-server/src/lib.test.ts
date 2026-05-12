import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { slugify, callApi, formatSearchResults, formatPageList, formatPageDetail } from "./lib.js";

describe("slugify", () => {
  it("converts title to lowercase slug", () => {
    expect(slugify("Q2 Revenue Analysis")).toBe("q2-revenue-analysis");
  });

  it("handles special characters", () => {
    expect(slugify("Hello, World! (2024)")).toBe("hello-world-2024");
  });

  it("handles unicode/accents", () => {
    expect(slugify("Café Résumé")).toBe("cafe-resume");
  });

  it("collapses multiple spaces and dashes", () => {
    expect(slugify("too   many   spaces")).toBe("too-many-spaces");
    expect(slugify("too---many---dashes")).toBe("too-many-dashes");
  });

  it("trims leading/trailing dashes", () => {
    expect(slugify(" -hello- ")).toBe("hello");
  });

  it("truncates to 80 characters", () => {
    const long = "a".repeat(100);
    expect(slugify(long).length).toBeLessThanOrEqual(80);
  });

  it("returns 'untitled' for empty input", () => {
    expect(slugify("")).toBe("untitled");
    expect(slugify("   ")).toBe("untitled");
  });

  it("returns 'untitled' for all-special-char input", () => {
    expect(slugify("!!!@@@###")).toBe("untitled");
  });
});

describe("callApi", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends correct request format", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ result: [{ slug: "test", title: "Test", matches: [] }] }),
    });

    await callApi("https://curata.ai", "ck_test123", "search", { query: "hello" });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://curata.ai/api/kazam",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer ck_test123",
        },
        body: JSON.stringify({ tool: "search", args: { query: "hello" } }),
      })
    );
  });

  it("returns result on success", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ result: { slug: "test-page" } }),
    });

    const res = await callApi("https://curata.ai", "ck_test", "read_page", { slug: "test-page" });
    expect(res.result).toEqual({ slug: "test-page" });
    expect(res.error).toBeUndefined();
  });

  it("returns error on 401", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "unauthorized" }),
    });

    const res = await callApi("https://curata.ai", "bad_key", "list_pages", {});
    expect(res.error).toContain("Unauthorized");
  });

  it("returns error on 403", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: "insufficient scope" }),
    });

    const res = await callApi("https://curata.ai", "ck_readonly", "write_page", { slug: "x", content: "y" });
    expect(res.error).toContain("Forbidden");
  });

  it("returns error on 429", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: "rate limit exceeded" }),
    });

    const res = await callApi("https://curata.ai", "ck_test", "search", { query: "x" });
    expect(res.error).toContain("Rate limit");
  });

  it("handles network errors", async () => {
    mockFetch.mockRejectedValue(new Error("fetch failed"));

    const res = await callApi("https://curata.ai", "ck_test", "search", { query: "x" });
    expect(res.error).toContain("Cannot reach curata");
  });

  it("handles timeout", async () => {
    const err = new Error("timeout");
    err.name = "TimeoutError";
    mockFetch.mockRejectedValue(err);

    const res = await callApi("https://curata.ai", "ck_test", "search", { query: "x" });
    expect(res.error).toContain("timed out");
  });

  it("returns API error message on non-ok response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "Internal server error" }),
    });

    const res = await callApi("https://curata.ai", "ck_test", "search", { query: "x" });
    expect(res.error).toBe("Internal server error");
  });
});

describe("formatSearchResults", () => {
  it("formats results with matches", () => {
    const results = [
      { slug: "q2-revenue", title: "Q2 Revenue", matches: ["Revenue: $1.2M", "Growth: 15%"] },
    ];
    const text = formatSearchResults(results, "revenue");
    expect(text).toContain("Q2 Revenue");
    expect(text).toContain("slug: q2-revenue");
    expect(text).toContain("Revenue: $1.2M");
  });

  it("returns no-results message", () => {
    const text = formatSearchResults([], "nonexistent");
    expect(text).toContain("No pages found");
    expect(text).toContain("nonexistent");
  });

  it("caps at 5 results", () => {
    const results = Array.from({ length: 8 }, (_, i) => ({
      slug: `page-${i}`,
      title: `Page ${i}`,
      matches: [],
    }));
    const text = formatSearchResults(results, "test");
    expect(text).toContain("...and 3 more results");
  });
});

describe("formatPageList", () => {
  it("formats page list with metadata", () => {
    const pages = [
      { title: "Test Page", slug: "test-page", viewCount: 42, annotationCount: 3, updatedAt: "2026-01-01T00:00:00Z" },
    ];
    const text = formatPageList(pages);
    expect(text).toContain("Test Page");
    expect(text).toContain("test-page");
    expect(text).toContain("42");
    expect(text).toContain("3");
  });

  it("returns empty message", () => {
    const text = formatPageList([]);
    expect(text).toContain("No pages");
  });
});

describe("formatPageDetail", () => {
  it("formats page with yaml and annotations", () => {
    const page = {
      slug: "test-page",
      yaml: "title: Test\nshell: document",
      contentHash: "abc123",
      sections: ["Overview", "Metrics"],
      annotations: [
        { text: "Needs update", author: "reviewer", status: "pending", kind: "note" },
      ],
    };
    const text = formatPageDetail(page);
    expect(text).toContain("# test-page");
    expect(text).toContain("abc123");
    expect(text).toContain("title: Test");
    expect(text).toContain("Overview");
    expect(text).toContain("Needs update");
  });

  it("handles page with no annotations or sections", () => {
    const page = { slug: "bare-page", yaml: "title: Bare" };
    const text = formatPageDetail(page);
    expect(text).toContain("# bare-page");
    expect(text).toContain("title: Bare");
    expect(text).not.toContain("Sections");
    expect(text).not.toContain("Annotations");
  });
});
