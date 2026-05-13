import { testDb } from "./setup";
import { generateApiKey } from "@/lib/api-key";

// ──────────────────────────────────────────────
// Factory helpers
// ──────────────────────────────────────────────

export async function createTestOrg(overrides: Record<string, unknown> = {}) {
  return testDb.organization.create({
    data: {
      name: "Test Org",
      slug: "test-org",
      ...overrides,
    },
  });
}

const DEFAULT_YAML = `title: Test
shell: document
components: []
`;

export async function createTestPage(
  orgId: string,
  overrides: Record<string, unknown> = {}
) {
  const { yamlContent, ...pageOverrides } = overrides as {
    yamlContent?: string;
    [k: string]: unknown;
  };
  const content = yamlContent ?? DEFAULT_YAML;
  const { createHash } = await import("crypto");
  const contentHash = createHash("sha256").update(content).digest("hex");

  return testDb.page.create({
    data: {
      orgId,
      slug: "test-page",
      title: "Test Page",
      createdBy: "test-user",
      versions: {
        create: {
          yamlContent: content,
          contentHash,
          createdBy: "test-user",
        },
      },
      ...pageOverrides,
    },
    include: { versions: true },
  });
}

export async function createTestApiKey(
  orgId: string,
  overrides: Record<string, unknown> = {}
) {
  const { key, prefix, hash } = generateApiKey();

  const record = await testDb.apiKey.create({
    data: {
      orgId,
      name: "Test Key",
      keyHash: hash,
      prefix,
      scopes: ["read", "write"],
      createdBy: "test-user",
      ...overrides,
    },
  });

  return { key, record };
}

export async function createTestAnnotation(
  pageId: string,
  overrides: Record<string, unknown> = {}
) {
  return testDb.annotation.create({
    data: {
      pageId,
      text: "Test annotation",
      author: "test-user",
      kind: "note",
      status: "pending",
      source: "web",
      ...overrides,
    },
  });
}
