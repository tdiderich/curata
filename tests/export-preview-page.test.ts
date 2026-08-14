import { describe, it, expect, vi, beforeEach } from "vitest";

const { notFoundMock, consumeExportNonceMock, readPageMock } = vi.hoisted(() => ({
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  consumeExportNonceMock: vi.fn(),
  readPageMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound: notFoundMock }));
vi.mock("@/lib/export-nonce", () => ({ consumeExportNonce: consumeExportNonceMock }));
vi.mock("@/lib/pages", () => ({ readPage: readPageMock }));
vi.mock("@/lib/theme", () => ({
  getOrgTheme: vi.fn().mockResolvedValue({ theme: "violet", mode: "dark", texture: "none", glow: "none" }),
}));
vi.mock("@/components/theme-script", () => ({ ThemeScript: () => null }));
vi.mock("@/generated/kazam-renderer", () => ({ PageRenderer: () => null }));

import ExportPreview from "@/app/export-preview/[slug]/page";

describe("export-preview page — nonce is bound to slug", () => {
  beforeEach(() => {
    notFoundMock.mockClear();
    consumeExportNonceMock.mockReset();
    readPageMock.mockReset();
  });

  it("404s when the nonce's slug does not match the URL slug", async () => {
    consumeExportNonceMock.mockResolvedValue({ orgId: "org-1", slug: "other-slug" });

    await expect(
      ExportPreview({
        params: Promise.resolve({ slug: "my-slug" }),
        searchParams: Promise.resolve({ nonce: "whatever" }),
      })
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(readPageMock).not.toHaveBeenCalled();
  });

  it("404s when a nonce bound to a hub is used with a mismatched hub param", async () => {
    consumeExportNonceMock.mockResolvedValue({ orgId: "org-1", slug: "my-slug", hub: "expected-hub" });

    await expect(
      ExportPreview({
        params: Promise.resolve({ slug: "my-slug" }),
        searchParams: Promise.resolve({ nonce: "whatever", hub: "different-hub" }),
      })
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("proceeds when the nonce's slug matches the URL slug", async () => {
    consumeExportNonceMock.mockResolvedValue({ orgId: "org-1", slug: "my-slug" });
    readPageMock.mockResolvedValue({ json: { title: "T", components: [] } });

    await expect(
      ExportPreview({
        params: Promise.resolve({ slug: "my-slug" }),
        searchParams: Promise.resolve({ nonce: "whatever" }),
      })
    ).resolves.toBeTruthy();
  });
});
