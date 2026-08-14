import { describe, it, expect, vi, beforeEach } from "vitest";
import { testDb } from "./setup";
import { createTestOrg } from "./helpers";

// Mock db to use test database
vi.mock("@/lib/db", async () => {
  const { testDb } = await import("./setup");
  return { db: testDb };
});

// No filesystem/browser side effects from tools unrelated to required-components.
vi.mock("@/lib/kazam", async () => {
  const os = await import("os");
  const path = await import("path");
  const tmpDir = path.join(os.tmpdir(), `curata-test-rc-${process.pid}`);
  return {
    sitePath: () => tmpDir,
    buildSite: vi.fn().mockResolvedValue(""),
    validateContent: vi.fn().mockResolvedValue([]),
    checkUnsupportedComponents: vi.fn().mockReturnValue([]),
  };
});

import {
  parseRequiredComponentsRules,
  validateRequiredComponentsRule,
  resolveRequiredComponentsRules,
  validateRequiredComponents,
  DEFAULT_REQUIRED_COMPONENTS_RULES,
} from "@/lib/required-components";
import { collectComponentIds } from "@/lib/component-ids";
import { dispatch } from "@/lib/mcp-dispatch";
import { createCaptureToken } from "@/lib/capture-token";

const CAPTURED_QA_YAML = (opts: { withProvenance?: boolean; pageType?: string } = {}) => `
title: "What is X?"
shell: document
pageType: ${opts.pageType ?? "captured-qa"}
components:
  - type: section
    id: question
    heading: "What is X?"
    components:
      - type: markdown
        body: "What is X?"
  - type: section
    id: answer
    heading: Answer
    components:
      - type: markdown
        body: "X is Y."
${opts.withProvenance === false ? "" : `  - type: section
    id: provenance
    heading: Provenance
    components:
      - type: markdown
        body: "Slack, 2026-08-14"
`}`;

describe("parseRequiredComponentsRules", () => {
  it("extracts required-components entries and ignores content/approval rules mixed in the same array", () => {
    const json = [
      { id: "no-emdash", text: "Never use em dashes.", mode: "block" },
      { id: "approval", kind: "approval", approvers: [{ type: "group", id: "g1" }] },
      { id: "captured-qa", kind: "required-components", pageType: "captured-qa", requiredComponentIds: ["question", "answer"], requireConcepts: true },
    ];
    const rules = parseRequiredComponentsRules(json);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      id: "captured-qa",
      kind: "required-components",
      pageType: "captured-qa",
      requiredComponentIds: ["question", "answer"],
      requireConcepts: true,
    });
  });

  it("drops entries missing a pageType", () => {
    const json = [{ id: "bad", kind: "required-components", requiredComponentIds: ["question"] }];
    expect(parseRequiredComponentsRules(json)).toHaveLength(0);
  });

  it("returns an empty array for null/non-array input", () => {
    expect(parseRequiredComponentsRules(null)).toEqual([]);
    expect(parseRequiredComponentsRules("nonsense")).toEqual([]);
  });
});

describe("validateRequiredComponentsRule", () => {
  it("accepts a well-formed rule", () => {
    const result = validateRequiredComponentsRule({
      pageType: "captured-qa",
      requiredComponentIds: ["question", "answer", "provenance"],
      requireConcepts: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rule.pageType).toBe("captured-qa");
      expect(result.rule.id).toBeTruthy();
    }
  });

  it("rejects a missing pageType", () => {
    expect(validateRequiredComponentsRule({ requiredComponentIds: ["question"] }).ok).toBe(false);
  });

  it("rejects a rule with no component ids, fields, or concept requirement", () => {
    expect(validateRequiredComponentsRule({ pageType: "captured-qa" }).ok).toBe(false);
  });

  it("accepts a rule defined only via requiredFields", () => {
    const result = validateRequiredComponentsRule({ pageType: "incident", requiredFields: ["title", "subtitle"] });
    expect(result.ok).toBe(true);
  });

  it("rejects a non-object candidate", () => {
    expect(validateRequiredComponentsRule(null).ok).toBe(false);
    expect(validateRequiredComponentsRule("nope").ok).toBe(false);
  });
});

describe("resolveRequiredComponentsRules cascade", () => {
  let orgId: string;

  beforeEach(async () => {
    const org = await createTestOrg({ name: "RC Cascade Org", slug: "rc-cascade-org" });
    orgId = org.id;
  });

  it("returns empty inherited/page when no scope defines a rule", async () => {
    const resolved = await resolveRequiredComponentsRules(orgId, null, null);
    expect(resolved.inherited).toEqual([]);
    expect(resolved.page).toEqual([]);
  });

  it("accumulates across global, folder, and page scopes (unlike the approval kind's single winner)", async () => {
    await testDb.organization.update({
      where: { id: orgId },
      data: { rules: [{ id: "captured-qa", kind: "required-components", pageType: "captured-qa", requiredComponentIds: ["question"] }] },
    });
    const folder = await testDb.folder.create({
      data: {
        orgId,
        name: "Docs",
        createdBy: "test-user",
        rules: [{ id: "incident", kind: "required-components", pageType: "incident", requiredComponentIds: ["summary"] }],
      },
    });
    const pageRulesJson = [{ id: "page-rule", kind: "required-components", pageType: "captured-qa", requiredComponentIds: ["provenance"] }];
    const resolved = await resolveRequiredComponentsRules(orgId, folder.id, pageRulesJson);
    expect(resolved.inherited).toHaveLength(2);
    expect(resolved.inherited.find((r) => r.scope === "global")?.pageType).toBe("captured-qa");
    expect(resolved.inherited.find((r) => r.scope === `folder:${folder.name}`)?.pageType).toBe("incident");
    expect(resolved.page).toHaveLength(1);
    expect(resolved.page[0].scope).toBe("page");
  });
});

describe("validateRequiredComponents", () => {
  const rules = [
    { id: "captured-qa", kind: "required-components" as const, pageType: "captured-qa", requiredComponentIds: ["question", "answer", "provenance"], requireConcepts: true, scope: "global" },
  ];

  it("passes a page with all required components and a concept tag", () => {
    const violations = validateRequiredComponents(CAPTURED_QA_YAML(), 1, rules);
    expect(violations).toEqual([]);
  });

  it("flags a missing component id", () => {
    const violations = validateRequiredComponents(CAPTURED_QA_YAML({ withProvenance: false }), 1, rules);
    expect(violations).toHaveLength(1);
    expect(violations[0].matches).toContain("provenance");
  });

  it("flags a missing concept tag", () => {
    const violations = validateRequiredComponents(CAPTURED_QA_YAML(), 0, rules);
    expect(violations).toHaveLength(1);
    expect(violations[0].matches).toContain("concepts");
    expect(violations[0].message).toContain("concept tag");
  });

  it("ignores pages that declare a different pageType", () => {
    const violations = validateRequiredComponents(CAPTURED_QA_YAML({ withProvenance: false, pageType: "faq" }), 0, rules);
    expect(violations).toEqual([]);
  });

  it("ignores pages that declare no pageType at all", () => {
    const yaml = `title: Untyped\nshell: document\ncomponents:\n  - type: markdown\n    body: hello\n`;
    expect(validateRequiredComponents(yaml, 0, rules)).toEqual([]);
  });

  it("checks required top-level fields when configured", () => {
    const fieldRules = [
      { id: "incident", kind: "required-components" as const, pageType: "incident", requiredComponentIds: [], requiredFields: ["subtitle"], scope: "global" },
    ];
    const withSubtitle = `title: Incident\nsubtitle: "Postmortem"\nshell: document\npageType: incident\ncomponents:\n  - type: markdown\n    body: hi\n`;
    const withoutSubtitle = `title: Incident\nshell: document\npageType: incident\ncomponents:\n  - type: markdown\n    body: hi\n`;
    expect(validateRequiredComponents(withSubtitle, 0, fieldRules)).toEqual([]);
    const violations = validateRequiredComponents(withoutSubtitle, 0, fieldRules);
    expect(violations).toHaveLength(1);
    expect(violations[0].matches).toContain("subtitle");
  });
});

describe("collectComponentIds", () => {
  it("collects ids from nested sections", () => {
    const components = [
      { type: "section", id: "question", components: [{ type: "markdown", id: "inner", body: "x" }] },
      { type: "divider", id: "d1" },
    ];
    const ids = collectComponentIds(components);
    expect(ids.has("question")).toBe(true);
    expect(ids.has("inner")).toBe(true);
    expect(ids.has("d1")).toBe(true);
  });
});

describe("DEFAULT_REQUIRED_COMPONENTS_RULES", () => {
  it("defines the captured-qa shape: question, answer, provenance, and a required concept tag", () => {
    const rule = DEFAULT_REQUIRED_COMPONENTS_RULES.find((r) => r.pageType === "captured-qa");
    expect(rule).toBeDefined();
    expect(rule?.requiredComponentIds).toEqual(["question", "answer", "provenance"]);
    expect(rule?.requireConcepts).toBe(true);
    expect(rule?.captureRequired).toBe(true);
  });
});

describe("dispatch write-path enforcement", () => {
  let orgId: string;
  let orgSlug: string;
  // captured-qa is capture-gated by default now; mint a pass for direct creates.
  const capturePass = (content: string) => ({
    capture_token: createCaptureToken(orgId, content),
    dedup_ack: "new",
  });

  beforeEach(async () => {
    const org = await createTestOrg({
      name: "RC Dispatch Org",
      slug: "rc-dispatch-org",
      rules: DEFAULT_REQUIRED_COMPONENTS_RULES,
    });
    orgId = org.id;
    orgSlug = org.slug;
  });

  it("create_page rejects a captured-qa page missing a required component", async () => {
    await expect(
      dispatch(
        "create_page",
        { slug: "captured-qa-bad", content: CAPTURED_QA_YAML({ withProvenance: false }), ...capturePass(CAPTURED_QA_YAML({ withProvenance: false })) },
        orgId,
        orgSlug,
        "apikey-1",
        "user-1"
      )
    ).rejects.toThrow(/required-components rule violation/);
  });

  it("create_page rejects a captured-qa page with no concept tag", async () => {
    await expect(
      dispatch(
        "create_page",
        { slug: "captured-qa-no-concepts", content: CAPTURED_QA_YAML(), ...capturePass(CAPTURED_QA_YAML()) },
        orgId,
        orgSlug,
        "apikey-1",
        "user-1"
      )
    ).rejects.toThrow(/concept tag/);
  });

  it("create_page accepts a captured-qa page with all components and a concept tag", async () => {
    const result = (await dispatch(
      "create_page",
      {
        slug: "captured-qa-good",
        content: CAPTURED_QA_YAML(),
        concepts: JSON.stringify([{ term: "pricing" }]),
        ...capturePass(CAPTURED_QA_YAML()),
      },
      orgId,
      orgSlug,
      "apikey-1",
      "user-1"
    )) as { ok: boolean };
    expect(result.ok).toBe(true);
  });

  it("create_page ignores required-components rules for untyped pages", async () => {
    const result = (await dispatch(
      "create_page",
      { slug: "untyped-page", content: `title: Plain\nshell: document\ncomponents:\n  - type: markdown\n    body: hi\n` },
      orgId,
      orgSlug,
      "apikey-1",
      "user-1"
    )) as { ok: boolean };
    expect(result.ok).toBe(true);
  });

  it("write_page rejects removing a required component from an existing captured-qa page", async () => {
    await dispatch(
      "create_page",
      { slug: "captured-qa-edit", content: CAPTURED_QA_YAML(), concepts: JSON.stringify([{ term: "pricing" }]), ...capturePass(CAPTURED_QA_YAML()) },
      orgId,
      orgSlug,
      "apikey-1",
      "user-1"
    );
    await expect(
      dispatch(
        "write_page",
        { slug: "captured-qa-edit", content: CAPTURED_QA_YAML({ withProvenance: false }) },
        orgId,
        orgSlug,
        "apikey-1",
        "user-1"
      )
    ).rejects.toThrow(/required-components rule violation/);
  });

  it("write_page rejects clearing every concept tag off an existing captured-qa page", async () => {
    await dispatch(
      "create_page",
      { slug: "captured-qa-declone", content: CAPTURED_QA_YAML(), concepts: JSON.stringify([{ term: "pricing" }]), ...capturePass(CAPTURED_QA_YAML()) },
      orgId,
      orgSlug,
      "apikey-1",
      "user-1"
    );
    await expect(
      dispatch(
        "write_page",
        {
          slug: "captured-qa-declone",
          content: CAPTURED_QA_YAML(),
          concepts: JSON.stringify([{ term: "pricing", remove: true }]),
        },
        orgId,
        orgSlug,
        "apikey-1",
        "user-1"
      )
    ).rejects.toThrow(/concept tag/);
  });

  it("patch_page validates the RESULT of the patch, not the ops — removing the provenance section is rejected", async () => {
    const created = (await dispatch(
      "create_page",
      { slug: "captured-qa-patch", content: CAPTURED_QA_YAML(), concepts: JSON.stringify([{ term: "pricing" }]), ...capturePass(CAPTURED_QA_YAML()) },
      orgId,
      orgSlug,
      "apikey-1",
      "user-1"
    )) as { contentHash: string };

    await expect(
      dispatch(
        "patch_page",
        {
          slug: "captured-qa-patch",
          expected_hash: created.contentHash,
          operations: JSON.stringify([{ op: "remove", id: "provenance" }]),
        },
        orgId,
        orgSlug,
        "apikey-1",
        "user-1"
      )
    ).rejects.toThrow(/required-components rule violation/);
  });

  it("patch_page (concepts-only) rejects clearing the last concept tag off a captured-qa page", async () => {
    await dispatch(
      "create_page",
      { slug: "captured-qa-tagpatch", content: CAPTURED_QA_YAML(), concepts: JSON.stringify([{ term: "pricing" }]), ...capturePass(CAPTURED_QA_YAML()) },
      orgId,
      orgSlug,
      "apikey-1",
      "user-1"
    );
    await expect(
      dispatch(
        "patch_page",
        { slug: "captured-qa-tagpatch", concepts: JSON.stringify([{ term: "pricing", remove: true }]) },
        orgId,
        orgSlug,
        "apikey-1",
        "user-1"
      )
    ).rejects.toThrow(/concept tag/);
  });

  it("patch_page accepts a valid operation that keeps the captured-qa shape intact", async () => {
    const created = (await dispatch(
      "create_page",
      { slug: "captured-qa-patch-ok", content: CAPTURED_QA_YAML(), concepts: JSON.stringify([{ term: "pricing" }]), ...capturePass(CAPTURED_QA_YAML()) },
      orgId,
      orgSlug,
      "apikey-1",
      "user-1"
    )) as { contentHash: string };

    const result = (await dispatch(
      "patch_page",
      {
        slug: "captured-qa-patch-ok",
        expected_hash: created.contentHash,
        operations: JSON.stringify([{ op: "set_field", field: "title", value: "Updated title" }]),
      },
      orgId,
      orgSlug,
      "apikey-1",
      "user-1"
    )) as { ok: boolean };
    expect(result.ok).toBe(true);
  });
});
