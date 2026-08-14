import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestOrg, createTestPage } from "./helpers";

// Mock db to use test database
vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});

// No filesystem/browser side effects from tools unrelated to capture_thread.
vi.mock("@/lib/kazam", async () => {
  const os = await import("os");
  const path = await import("path");
  const tmpDir = path.join(os.tmpdir(), `curata-test-capture-${process.pid}`);
  return {
    sitePath: () => tmpDir,
    buildSite: vi.fn().mockResolvedValue(""),
    validateContent: vi.fn().mockResolvedValue([]),
    checkUnsupportedComponents: vi.fn().mockReturnValue([]),
  };
});

import { dispatch } from "@/lib/mcp-dispatch";
import { createCaptureToken } from "@/lib/capture-token";

const CAPTURED_QA_YAML = (opts: { withProvenance?: boolean; concepts?: boolean } = {}) => `
title: "What is our pricing?"
shell: document
pageType: captured-qa
components:
  - type: section
    id: question
    heading: "What is our pricing?"
    components:
      - type: markdown
        body: "What is our pricing?"
  - type: section
    id: answer
    heading: Answer
    components:
      - type: markdown
        body: "Our enterprise tier includes SSO and unlimited seats for $499 per month, billed annually with a dedicated CSM."
${opts.withProvenance === false ? "" : `  - type: section
    id: provenance
    heading: Provenance
    components:
      - type: markdown
        body: "Slack thread, 2026-08-14"
`}`;

const CAPTURE_REQUIRED_RULE = {
  id: "captured-qa-gated",
  kind: "required-components" as const,
  pageType: "captured-qa",
  requiredComponentIds: ["question", "answer", "provenance"],
  requireConcepts: true,
  captureRequired: true,
};

const THREAD_CONTENT = `Customer asked in Slack about pricing.
Our enterprise tier includes SSO and unlimited seats for $499 per month, billed annually with a dedicated CSM.
We confirmed this is accurate and worth keeping.`;

describe("capture_thread dispatch", () => {
  let orgId: string;
  let orgSlug: string;

  beforeEach(async () => {
    const org = await createTestOrg({
      name: "Capture Org",
      slug: "capture-org",
      rules: [CAPTURE_REQUIRED_RULE],
    });
    orgId = org.id;
    orgSlug = org.slug;
  });

  it("returns a checklist derived from the resolved required-components rule, not hardcoded", async () => {
    const result = (await dispatch(
      "capture_thread",
      { content: THREAD_CONTENT },
      orgId,
      orgSlug,
      "apikey-1",
      "user-1"
    )) as { checklist: Record<string, unknown> | null };

    expect(result.checklist).toEqual({
      pageType: "captured-qa",
      requiredComponentIds: ["question", "answer", "provenance"],
      requiredFields: [],
      requireConcepts: true,
      captureRequired: true,
    });
  });

  it("returns null checklist for a page type with no resolved rule", async () => {
    const result = (await dispatch(
      "capture_thread",
      { content: THREAD_CONTENT, page_type: "totally-custom-type" },
      orgId,
      orgSlug,
      "apikey-1",
      "user-1"
    )) as { checklist: unknown };
    expect(result.checklist).toBeNull();
  });

  it("returns a capture_token good for ~15 minutes", async () => {
    const result = (await dispatch(
      "capture_thread",
      { content: THREAD_CONTENT },
      orgId,
      orgSlug,
      "apikey-1",
      "user-1"
    )) as { captureToken: string; expiresInSeconds: number };
    expect(typeof result.captureToken).toBe("string");
    expect(result.captureToken.split(".")).toHaveLength(2);
    expect(result.expiresInSeconds).toBe(15 * 60);
  });

  it("surfaces a seeded near-duplicate page via full-text dedup", async () => {
    await createTestPage(orgId, {
      slug: "existing-pricing-faq",
      title: "Existing Pricing FAQ",
      yamlContent: `title: Existing Pricing FAQ\nshell: document\ncomponents:\n  - type: markdown\n    body: "Our enterprise tier includes SSO and unlimited seats for $499 per month, billed annually with a dedicated CSM."\n`,
    });

    const result = (await dispatch(
      "capture_thread",
      { content: THREAD_CONTENT },
      orgId,
      orgSlug,
      "apikey-1",
      "user-1"
    )) as { dedupCandidates: Array<{ slug: string; whyMatched: string }> };

    expect(result.dedupCandidates.some((c) => c.slug === "existing-pricing-faq")).toBe(true);
  });

  it("does not surface unrelated pages", async () => {
    await createTestPage(orgId, {
      slug: "unrelated-page",
      title: "Unrelated Page",
      yamlContent: `title: Unrelated Page\nshell: document\ncomponents:\n  - type: markdown\n    body: "This page is about something else entirely."\n`,
    });

    const result = (await dispatch(
      "capture_thread",
      { content: THREAD_CONTENT },
      orgId,
      orgSlug,
      "apikey-1",
      "user-1"
    )) as { dedupCandidates: Array<{ slug: string }> };

    expect(result.dedupCandidates.some((c) => c.slug === "unrelated-page")).toBe(false);
  });

  it("echoes source metadata when provided", async () => {
    const result = (await dispatch(
      "capture_thread",
      { content: THREAD_CONTENT, source: JSON.stringify({ url: "https://slack.com/x", participants: ["tyler"] }) },
      orgId,
      orgSlug,
      "apikey-1",
      "user-1"
    )) as { source?: { url: string } };
    expect(result.source?.url).toBe("https://slack.com/x");
  });

  it("rejects invalid source JSON", async () => {
    await expect(
      dispatch("capture_thread", { content: THREAD_CONTENT, source: "not json" }, orgId, orgSlug, "apikey-1", "user-1")
    ).rejects.toThrow(/source must be valid JSON/);
  });

  it("rejects content over the 200KB bound", async () => {
    const hugeContent = "x".repeat(200 * 1024 + 1);
    await expect(
      dispatch("capture_thread", { content: hugeContent }, orgId, orgSlug, "apikey-1", "user-1")
    ).rejects.toThrow(/too large/);
  });

  it("accepts content right at the 200KB bound", async () => {
    const exactContent = "x".repeat(200 * 1024);
    const result = (await dispatch(
      "capture_thread",
      { content: exactContent },
      orgId,
      orgSlug,
      "apikey-1",
      "user-1"
    )) as { captureToken: string };
    expect(typeof result.captureToken).toBe("string");
  });
});

describe("create-path capture gate", () => {
  let orgId: string;
  let orgSlug: string;

  beforeEach(async () => {
    const org = await createTestOrg({
      name: "Gated Org",
      slug: "gated-org",
      rules: [CAPTURE_REQUIRED_RULE],
    });
    orgId = org.id;
    orgSlug = org.slug;
  });

  it("create_page rejects a gated pageType with no capture_token", async () => {
    await expect(
      dispatch(
        "create_page",
        { slug: "new-capture", content: CAPTURED_QA_YAML(), concepts: JSON.stringify([{ term: "pricing" }]) },
        orgId,
        orgSlug,
        "apikey-1",
        "user-1"
      )
    ).rejects.toThrow(/capture_thread/);
  });

  it("create_page rejects a gated pageType with an invalid capture_token", async () => {
    await expect(
      dispatch(
        "create_page",
        {
          slug: "new-capture",
          content: CAPTURED_QA_YAML(),
          concepts: JSON.stringify([{ term: "pricing" }]),
          capture_token: "bogus.token",
          dedup_ack: "new",
        },
        orgId,
        orgSlug,
        "apikey-1",
        "user-1"
      )
    ).rejects.toThrow(/invalid capture_token/);
  });

  it("create_page rejects an expired capture_token", async () => {
    const expiredToken = createCaptureToken(orgId, THREAD_CONTENT, -1);
    await expect(
      dispatch(
        "create_page",
        {
          slug: "new-capture",
          content: CAPTURED_QA_YAML(),
          concepts: JSON.stringify([{ term: "pricing" }]),
          capture_token: expiredToken,
          dedup_ack: "new",
        },
        orgId,
        orgSlug,
        "apikey-1",
        "user-1"
      )
    ).rejects.toThrow(/expired/);
  });

  it("create_page rejects a valid capture_token from a different org", async () => {
    const otherOrg = await createTestOrg({ name: "Other Org", slug: "other-capture-org" });
    const tokenForOtherOrg = createCaptureToken(otherOrg.id, THREAD_CONTENT);
    await expect(
      dispatch(
        "create_page",
        {
          slug: "new-capture",
          content: CAPTURED_QA_YAML(),
          concepts: JSON.stringify([{ term: "pricing" }]),
          capture_token: tokenForOtherOrg,
          dedup_ack: "new",
        },
        orgId,
        orgSlug,
        "apikey-1",
        "user-1"
      )
    ).rejects.toThrow(/different organization/);
  });

  it("create_page rejects a valid capture_token missing dedup_ack", async () => {
    const token = createCaptureToken(orgId, THREAD_CONTENT);
    await expect(
      dispatch(
        "create_page",
        {
          slug: "new-capture",
          content: CAPTURED_QA_YAML(),
          concepts: JSON.stringify([{ term: "pricing" }]),
          capture_token: token,
        },
        orgId,
        orgSlug,
        "apikey-1",
        "user-1"
      )
    ).rejects.toThrow(/dedup_ack/);
  });

  it("create_page rejects when dedup_ack names a candidate slug — redirects to patch_page", async () => {
    await createTestPage(orgId, {
      slug: "existing-pricing-faq",
      title: "Existing Pricing FAQ",
      yamlContent: `title: Existing Pricing FAQ\nshell: document\ncomponents:\n  - type: markdown\n    body: hi\n`,
    });
    const token = createCaptureToken(orgId, THREAD_CONTENT);
    await expect(
      dispatch(
        "create_page",
        {
          slug: "new-capture",
          content: CAPTURED_QA_YAML(),
          concepts: JSON.stringify([{ term: "pricing" }]),
          capture_token: token,
          dedup_ack: "existing-pricing-faq",
        },
        orgId,
        orgSlug,
        "apikey-1",
        "user-1"
      )
    ).rejects.toThrow(/update "existing-pricing-faq" via patch_page/);
  });

  it("create_page succeeds with a valid capture_token and dedup_ack \"new\"", async () => {
    const token = createCaptureToken(orgId, THREAD_CONTENT);
    const result = (await dispatch(
      "create_page",
      {
        slug: "new-capture",
        content: CAPTURED_QA_YAML(),
        concepts: JSON.stringify([{ term: "pricing" }]),
        capture_token: token,
        dedup_ack: "new",
      },
      orgId,
      orgSlug,
      "apikey-1",
      "user-1"
    )) as { ok: boolean };
    expect(result.ok).toBe(true);
  });

  it("write_page creating a brand-new gated page is gated the same as create_page", async () => {
    await expect(
      dispatch(
        "write_page",
        { slug: "new-capture-via-write", content: CAPTURED_QA_YAML(), concepts: JSON.stringify([{ term: "pricing" }]) },
        orgId,
        orgSlug,
        "apikey-1",
        "user-1"
      )
    ).rejects.toThrow(/capture_thread/);

    const token = createCaptureToken(orgId, THREAD_CONTENT);
    const result = (await dispatch(
      "write_page",
      {
        slug: "new-capture-via-write",
        content: CAPTURED_QA_YAML(),
        concepts: JSON.stringify([{ term: "pricing" }]),
        capture_token: token,
        dedup_ack: "new",
      },
      orgId,
      orgSlug,
      "apikey-1",
      "user-1"
    )) as { ok: boolean };
    expect(result.ok).toBe(true);
  });

  it("write_page updating an EXISTING gated page does not require a capture_token", async () => {
    const token = createCaptureToken(orgId, THREAD_CONTENT);
    await dispatch(
      "create_page",
      {
        slug: "already-captured",
        content: CAPTURED_QA_YAML(),
        concepts: JSON.stringify([{ term: "pricing" }]),
        capture_token: token,
        dedup_ack: "new",
      },
      orgId,
      orgSlug,
      "apikey-1",
      "user-1"
    );

    const result = (await dispatch(
      "write_page",
      { slug: "already-captured", content: CAPTURED_QA_YAML() },
      orgId,
      orgSlug,
      "apikey-1",
      "user-1"
    )) as { ok: boolean };
    expect(result.ok).toBe(true);
  });

  it("patch_page updating an EXISTING gated page does not require a capture_token", async () => {
    const token = createCaptureToken(orgId, THREAD_CONTENT);
    const created = (await dispatch(
      "create_page",
      {
        slug: "already-captured-patch",
        content: CAPTURED_QA_YAML(),
        concepts: JSON.stringify([{ term: "pricing" }]),
        capture_token: token,
        dedup_ack: "new",
      },
      orgId,
      orgSlug,
      "apikey-1",
      "user-1"
    )) as { contentHash: string };

    const result = (await dispatch(
      "patch_page",
      {
        slug: "already-captured-patch",
        expected_hash: created.contentHash,
        operations: JSON.stringify([{ op: "set_field", field: "title", value: "Updated" }]),
      },
      orgId,
      orgSlug,
      "apikey-1",
      "user-1"
    )) as { ok: boolean };
    expect(result.ok).toBe(true);
  });

  it("create_page rejects a second create reusing the same capture_token", async () => {
    const token = createCaptureToken(orgId, THREAD_CONTENT);
    const first = (await dispatch(
      "create_page",
      {
        slug: "first-capture",
        content: CAPTURED_QA_YAML(),
        concepts: JSON.stringify([{ term: "pricing" }]),
        capture_token: token,
        dedup_ack: "new",
      },
      orgId,
      orgSlug,
      "apikey-1",
      "user-1"
    )) as { ok: boolean };
    expect(first.ok).toBe(true);

    await expect(
      dispatch(
        "create_page",
        {
          slug: "second-capture",
          content: CAPTURED_QA_YAML(),
          concepts: JSON.stringify([{ term: "pricing" }]),
          capture_token: token,
          dedup_ack: "new",
        },
        orgId,
        orgSlug,
        "apikey-1",
        "user-1"
      )
    ).rejects.toThrow(/already used/);
  });

  it("create_page for an ungated pageType (no captureRequired rule) never needs a token", async () => {
    const plainOrg = await createTestOrg({ name: "Plain Org", slug: "plain-capture-org" });
    const result = (await dispatch(
      "create_page",
      { slug: "plain-page", content: `title: Plain\nshell: document\ncomponents:\n  - type: markdown\n    body: hi\n` },
      plainOrg.id,
      plainOrg.slug,
      "apikey-1",
      "user-1"
    )) as { ok: boolean };
    expect(result.ok).toBe(true);
  });
});
