// Shared MCP tool dispatch — the single registry of agent-facing tools.
// Consumed by both HTTP transports (src/app/api/mcp/route.ts and
// src/app/api/mcp/stream/route.ts) so the two surfaces can't drift apart.
// tests/mcp-tool-parity.test.ts enforces that every tool listed here is
// registered on the streamable-HTTP server.
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import {
  listPages,
  readPage,
  readPageYaml,
  writePage,
  getAnnotations,
  getPageSections,
  saveAnnotation,
  updateAnnotationStatus,
  searchPages,
  getSiteConfig,
  bumpViewCount,
  markTrusted,
  clearTrusted,
  getReviewQueue,
} from "@/lib/pages";
import type { Channel } from "@/lib/pages";
import { getOrgTheme } from "@/lib/theme";
import { buildTitlePageHtml, buildAppendixHtml } from "@/lib/export";
import { getChromium, previewUrl, screenshotPage, renderHtmlToPng } from "@/lib/export-render";
import { validateContent, checkUnsupportedComponents, invalidContentMessage } from "@/lib/kazam";
import { checkFolderBoundary, mcpDefaultVisibility, listPagesWhere } from "@/lib/access";
import { resolveRules, validateContentRules, detectFolderCycle } from "@/lib/content-rules";
import { validateApprovalRule, canApprove, getApprovers, describeApprovalRule, makeApprovalRuleResolver, resolveEffectiveTrustMode } from "@/lib/approval";
import type { Role } from "@/lib/permissions";
import { resolveRequiredComponentsRules, validateRequiredComponents, validateRequiredComponentsRule, ensureDefaultRequiredComponentsRules } from "@/lib/required-components";
import { enforceCaptureGate } from "@/lib/capture-gate";
import { ensureSeedPages } from "@/lib/seed";
import { createCaptureToken, CAPTURE_TOKEN_TTL_MS } from "@/lib/capture-token";
import { findCaptureDedupCandidates } from "@/lib/capture-dedup";
import { gatherDigestData, digestSlug, digestTitle, buildDigestPageYaml } from "@/lib/digest";
import type { DigestBigThing, DigestNoteworthyItem } from "@/lib/digest";
import { sweepVersions } from "@/lib/version-retention";
import type { Prisma } from "@/generated/prisma/client";
import {
  upsertConcepts,
  upsertLinks,
  getPageConcepts,
  getPageLinks,
  getVocabulary,
  getRelated,
  getSemanticMap,
  projectConceptTerms,
} from "@/lib/concepts";
import type { ConceptInput, LinkInput } from "@/lib/concepts";
import { ensureComponentIds, applyPatchOperations } from "@/lib/component-ids";
import type { PatchOperation } from "@/lib/component-ids";
import { expandComponentRefs, agentRefWrap } from "@/lib/component-refs";
import {
  createGroup,
  renameGroup,
  deleteGroup,
  listGroupsWithMembers,
  addGroupMembers,
  removeGroupMember,
  assertGroupManager,
  isOrgManager,
} from "@/lib/groups";
import yaml from "js-yaml";
import fs from "fs";
import path from "path";

export const READ_TOOLS = [
  "list_pages",
  "read_page",
  "search",
  "get_config",
  "list_annotations",
  "list_open_annotations",
  "list_flags",
  "get_review_queue",
  "get_component_reference",
  "list_folders",
  "get_folder_structure",
  "get_versions",
  "validate_page",
  "list_workflows",
  "list_templates",
  "get_vocabulary",
  "get_related",
  "get_semantic_map",
  "export_page",
  "export_report",
  "list_rules",
  "list_groups",
  "capture_thread",
];
export const WRITE_TOOLS = ["write_page", "create_page", "move_page", "annotate_page", "update_annotation", "patch_page", "create_folder", "update_folder", "create_from_template", "flag_page", "set_rules", "create_group", "update_group", "delete_group", "add_group_member", "remove_group_member", "mark_trusted", "clear_trusted", "generate_digest"];
export const ALL_TOOLS = [...READ_TOOLS, ...WRITE_TOOLS];

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

// capture_thread's content arg is a raw pasted thread/transcript, not a
// bounded YAML page body — without a cap a single call can push an
// arbitrarily large payload through the dedup phrase/term extraction and
// into the capture_token's signed fingerprint.
const CAPTURE_CONTENT_MAX_BYTES = 200 * 1024;

const TOOL_PARAMS: Record<string, { known: Set<string>; aliases?: Record<string, string> }> = {
  list_pages: { known: new Set(["channel"]) },
  read_page: { known: new Set(["slug", "channel"]) },
  search: { known: new Set(["query", "channel"]) },
  get_config: { known: new Set() },
  list_annotations: { known: new Set(["slug"]) },
  list_open_annotations: { known: new Set(["slug"]) },
  flag_page: { known: new Set(["slug", "action", "reason", "evidence", "superseded_by", "confidence"]), aliases: { supersededBy: "superseded_by" } },
  list_flags: { known: new Set(["status"]) },
  get_review_queue: { known: new Set() },
  get_component_reference: { known: new Set() },
  list_folders: { known: new Set() },
  get_folder_structure: { known: new Set() },
  create_folder: { known: new Set(["name", "parent_id", "visibility", "rules"]), aliases: { parentId: "parent_id" } },
  update_folder: { known: new Set(["id", "name", "parent_id", "visibility", "rules"]), aliases: { parentId: "parent_id" } },
  get_versions: { known: new Set(["slug", "limit"]) },
  validate_page: { known: new Set(["slug", "content"]) },
  create_page: { known: new Set(["slug", "content", "folder_id", "visibility", "rules", "concepts", "links", "capture_token", "dedup_ack"]), aliases: { folderId: "folder_id" } },
  move_page: { known: new Set(["slug", "folder_id"]), aliases: { folderId: "folder_id" } },
  write_page: { known: new Set(["slug", "content", "expected_hash", "visibility", "folder_id", "concepts", "links", "rules", "capture_token", "dedup_ack"]), aliases: { folderId: "folder_id" } },
  annotate_page: { known: new Set(["slug", "text", "section", "kind", "replacement", "source"]) },
  update_annotation: { known: new Set(["slug", "annotation_id", "status"]), aliases: { annotationId: "annotation_id" } },
  patch_page: { known: new Set(["slug", "expected_hash", "operations", "concepts", "links"]) },
  replace_in_page: { known: new Set(["slug", "target", "replacement"]) },
  // Pre-existing mismatch fixed in passing: the dispatch case reads
  // args.target_slug throughout, but the whitelist only ever allowed "slug" —
  // any caller passing target_slug (the only name that actually works) was
  // rejected as an unknown parameter. Keep "slug" too since removing an
  // already-known key could break an existing caller relying on the alias.
  create_from_template: { known: new Set(["template_slug", "slug", "target_slug", "variables", "folder_id"]), aliases: { templateSlug: "template_slug", folderId: "folder_id" } },
  list_workflows: { known: new Set() },
  list_templates: { known: new Set() },
  get_vocabulary: { known: new Set(["kind", "query"]) },
  get_related: { known: new Set(["slug", "term"]) },
  get_semantic_map: { known: new Set(["kind"]) },
  export_page: { known: new Set(["slug", "format"]) },
  export_report: { known: new Set(["slugs", "title", "subtitle"]) },
  list_rules: { known: new Set(["slug"]) },
  set_rules: { known: new Set(["scope", "scope_id", "rules"]) },
  list_groups: { known: new Set() },
  capture_thread: { known: new Set(["content", "source", "page_type", "folder_id"]), aliases: { pageType: "page_type", folderId: "folder_id" } },
  create_group: { known: new Set(["name"]) },
  update_group: { known: new Set(["group_id", "name"]), aliases: { groupId: "group_id" } },
  delete_group: { known: new Set(["group_id"]), aliases: { groupId: "group_id" } },
  add_group_member: { known: new Set(["group_id", "user_ids", "role"]), aliases: { groupId: "group_id", userIds: "user_ids" } },
  remove_group_member: { known: new Set(["group_id", "user_id"]), aliases: { groupId: "group_id", userId: "user_id" } },
  mark_trusted: { known: new Set(["slug", "version_id"]), aliases: { versionId: "version_id" } },
  clear_trusted: { known: new Set(["slug"]) },
  generate_digest: { known: new Set(["preview", "big_thing", "noteworthy"]) },
};

const DIGEST_FOLDER_NAME = "Digests";

/// Find-or-create the Digests folder, mirroring seed.ts's findOrCreateFolder
/// pattern for the app's other generated/system folders — but left unlocked
/// (unlike Templates/Skills) since generate_digest re-writes the same page
/// week over week and a locked folder would block that update.
async function ensureDigestsFolder(orgId: string, actorId: string): Promise<string> {
  const existing = await db.folder.findFirst({ where: { orgId, name: DIGEST_FOLDER_NAME } });
  if (existing) return existing.id;
  const created = await db.folder.create({
    data: { orgId, name: DIGEST_FOLDER_NAME, visibility: "org", createdBy: actorId },
  });
  return created.id;
}

/// True for the handful of string spellings a caller might reasonably send
/// for a boolean flag over the string-typed dispatch args channel.
function truthyArg(v: string | undefined): boolean {
  return v === "true" || v === "1";
}

/// Looks up a page by slug, scoped to what this caller can actually see —
/// same filter list_pages/search_pages use (listPagesWhere), not a second
/// visibility rule invented for digest links. Used to validate big_thing and
/// noteworthy slugs and to recover their titles for the rendered link text.
async function resolveVisibleDigestPage(
  orgId: string,
  userId: string | undefined,
  slug: string
): Promise<{ title: string } | null> {
  return db.page.findFirst({
    where: { ...listPagesWhere(orgId, userId ?? null), slug },
    select: { title: true },
  });
}

/// Parses and validates the generate_digest big_thing param. Throws a
/// teaching error naming exactly what to fix, matching the style used
/// elsewhere in this file (flag_page, create_page).
async function parseDigestBigThing(
  orgId: string,
  userId: string | undefined,
  raw: string
): Promise<DigestBigThing> {
  let parsed: { headline?: string; body?: string; slug?: string; also_considered?: string[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('big_thing must be valid JSON: {headline, body, slug?, also_considered?}');
  }
  if (!parsed.headline) throw new Error("big_thing.headline is required");
  if (parsed.headline.length > 80) {
    throw new Error(`big_thing.headline must be 80 characters or fewer, got ${parsed.headline.length} - tighten it to a single short line`);
  }
  if (!parsed.body) throw new Error("big_thing.body is required (1-3 sentences)");
  let title: string | undefined;
  if (parsed.slug) {
    if (!SLUG_RE.test(parsed.slug)) throw new Error("big_thing.slug is not a valid slug format");
    const page = await resolveVisibleDigestPage(orgId, userId, parsed.slug);
    if (!page) {
      throw new Error(`big_thing.slug "${parsed.slug}" does not exist in this org or is not visible to this caller - check the slug with read_page, or omit slug to render the pick without a link`);
    }
    title = page.title;
  }
  if (parsed.also_considered && !Array.isArray(parsed.also_considered)) {
    throw new Error("big_thing.also_considered must be an array of strings");
  }
  return {
    headline: parsed.headline,
    body: parsed.body,
    slug: parsed.slug,
    title,
    alsoConsidered: parsed.also_considered,
  };
}

/// Parses and validates the generate_digest noteworthy param: max 3 items,
/// each with length-bounded summary/description and a slug that must resolve
/// to a page this caller can see.
async function parseDigestNoteworthy(
  orgId: string,
  userId: string | undefined,
  raw: string
): Promise<DigestNoteworthyItem[]> {
  let parsedList: unknown;
  try {
    parsedList = JSON.parse(raw);
  } catch {
    throw new Error("noteworthy must be valid JSON: [{summary, description, slug}]");
  }
  if (!Array.isArray(parsedList)) throw new Error("noteworthy must be a JSON array");
  if (parsedList.length > 3) {
    throw new Error(`noteworthy accepts at most 3 items, got ${parsedList.length} - pick the most important ones`);
  }
  const items: DigestNoteworthyItem[] = [];
  for (const [i, raw] of parsedList.entries()) {
    const item = raw as { summary?: string; description?: string; slug?: string };
    if (!item.summary) throw new Error(`noteworthy[${i}].summary is required`);
    if (item.summary.length > 40) {
      throw new Error(`noteworthy[${i}].summary must be 40 characters or fewer (2-5 words), got ${item.summary.length}`);
    }
    if (!item.description) throw new Error(`noteworthy[${i}].description is required (one sentence)`);
    if (item.description.length > 200) {
      throw new Error(`noteworthy[${i}].description must be 200 characters or fewer, got ${item.description.length}`);
    }
    if (!item.slug) throw new Error(`noteworthy[${i}].slug is required`);
    if (!SLUG_RE.test(item.slug)) throw new Error(`noteworthy[${i}].slug is not a valid slug format`);
    const page = await resolveVisibleDigestPage(orgId, userId, item.slug);
    if (!page) {
      throw new Error(`noteworthy[${i}].slug "${item.slug}" does not exist in this org or is not visible to this caller - check the slug with read_page`);
    }
    items.push({ summary: item.summary, description: item.description, slug: item.slug, title: page.title });
  }
  return items;
}

function validateParams(tool: string, args: Record<string, string>): Record<string, string> {
  const spec = TOOL_PARAMS[tool];
  if (!spec) return args;
  const corrected = { ...args };
  if (spec.aliases) {
    for (const [alias, canonical] of Object.entries(spec.aliases)) {
      if (alias in corrected && !(canonical in corrected)) {
        corrected[canonical] = corrected[alias];
        delete corrected[alias];
      }
    }
  }
  const unknown = Object.keys(corrected).filter((k) => !spec.known.has(k));
  if (unknown.length > 0) {
    const suggestions = unknown.map((k) => {
      const close = [...spec.known].find((p) => p.replace(/_/g, "") === k.replace(/[_-]/g, "").toLowerCase());
      return close ? `"${k}" (did you mean "${close}"?)` : `"${k}"`;
    });
    throw new Error(`unknown parameter${unknown.length > 1 ? "s" : ""} for ${tool}: ${suggestions.join(", ")}. Valid: ${[...spec.known].join(", ")}`);
  }
  return corrected;
}

/// Agents default to "trusted" (with the labeled fallback when nothing's
/// been marked yet) — the whole point of the channel is that agents get the
/// human-approved content unless they explicitly ask for latest.
function resolveChannelArg(args: Record<string, string>): Channel {
  if (!args.channel || args.channel === "trusted") return "trusted";
  if (args.channel === "latest") return "latest";
  throw new Error(`channel must be "trusted" or "latest", got "${args.channel}"`);
}

/// mark_trusted/clear_trusted reuse the exact eligibility gate the dashboard's
/// POST/DELETE /api/versions/trust route enforces (canApprove) — but the
/// dispatch surface doesn't carry an org role the way resolveOrg() does, only
/// userId. isOrgManager (groups.ts) already resolves "is this userId an
/// owner/admin" the same way for group management, including the same
/// system-id conventions — reuse it rather than inventing a second lookup.
/// canApprove only branches on owner/admin vs everyone else, so collapsing
/// non-managers to "member" here is equivalent to the real role.
async function resolveTrustEligibility(orgId: string, userId: string | undefined, slug: string): Promise<boolean> {
  const actorUserId = userId || "agent";
  const orgRole: Role = (await isOrgManager(orgId, actorUserId)) ? "owner" : "member";
  return canApprove(orgId, actorUserId, orgRole, slug);
}

/// Same wording as approvalDenialMessage in api/versions/trust/route.ts.
async function trustDenialMessage(orgId: string, slug: string): Promise<string> {
  const resolved = await getApprovers(orgId, slug);
  if (!resolved) return "forbidden";
  const note = await describeApprovalRule(orgId, resolved.rule);
  return `forbidden: ${note}`;
}

export async function dispatch(
  tool: string,
  args: Record<string, string>,
  orgId: string,
  orgSlug: string,
  actorId: string,
  userId?: string
): Promise<unknown> {
  args = validateParams(tool, args);
  switch (tool) {
    case "list_pages": {
      const channel = resolveChannelArg(args);
      const [pages, folders] = await Promise.all([
        listPages(orgId, userId, channel),
        db.folder.findMany({ where: { orgId }, select: { id: true, name: true } }),
      ]);
      const folderMap = new Map(folders.map((f) => [f.id, f.name]));
      return pages.map((p) => ({ ...p, folderName: p.folderId ? folderMap.get(p.folderId) ?? null : null }));
    }

    case "read_page": {
      if (!args.slug) throw new Error("slug is required");
      if (!SLUG_RE.test(args.slug)) throw new Error("invalid slug format");
      // Orgs created before a seed page existed (batch-2 skills, FDE skills)
      // never got it — backfill missing seed pages here so a thin-pointer
      // SKILL.md doesn't 404 on read_page. See ensureSeedPages in
      // src/lib/seed.ts for why this is safe to run on every call.
      await ensureSeedPages(orgId);
      const channel = resolveChannelArg(args);
      const result = await readPageYaml(orgId, args.slug, channel);
      if (!result) throw new Error(`page not found: ${args.slug}`);

      const parsed = yaml.load(result.yaml) as Record<string, unknown>;
      if (Array.isArray(parsed.components)) {
        parsed.components = ensureComponentIds(parsed.components as Record<string, unknown>[]);
        // Expand `type: ref` shared-component blocks for display only — the
        // stored doc (and result.contentHash below) still reflects the
        // unexpanded ref, so patch_page continues to target the ref block
        // itself, not this expanded view.
        parsed.components = await expandComponentRefs(parsed.components as Record<string, unknown>[], {
          orgId,
          channel,
          viewer: { userId: userId ?? null, orgMemberRole: "member" },
          ...agentRefWrap(),
        });
        result.yaml = yaml.dump(parsed, { lineWidth: -1, noRefs: true });
      }

      const page = await db.page.findUnique({
        where: { orgId_slug: { orgId, slug: args.slug } },
        select: { id: true, folderId: true, rules: true, visibility: true },
      });

      const [sections, annotations] = await Promise.all([
        getPageSections(orgId, args.slug, channel),
        getAnnotations(orgId, args.slug),
      ]);

      if (page) {
        bumpViewCount(page.id).catch(() => {});
      }

      const concepts = page ? await getPageConcepts(page.id) : [];
      const links = page ? await getPageLinks(orgId, page.id) : [];
      const rules = await resolveRules(orgId, page?.folderId ?? null, page?.rules);

      const trustResolved = page
        ? await resolveEffectiveTrustMode(orgId, page.folderId, page.rules)
        : { mode: "auto" as const, scope: "default" };

      const response: Record<string, unknown> = {
        slug: args.slug,
        yaml: result.yaml,
        contentHash: result.contentHash,
        sections,
        annotations,
        concepts,
        links,
        trusted: result.trusted,
        trustedBehind: result.trustedBehind,
        trustMode: trustResolved.mode,
      };

      const visibleRules = page?.visibility === "public"
        ? rules.page
        : [...rules.inherited, ...rules.page];
      if (visibleRules.length > 0) {
        response.contentRules = visibleRules.map((r) => ({
          id: r.id,
          text: r.text,
          mode: r.mode,
          scope: r.scope,
        }));
      }

      return response;
    }

    case "search": {
      if (!args.query) throw new Error("query is required");
      const channel = resolveChannelArg(args);
      return searchPages(orgId, args.query, userId, {}, channel);
    }

    case "get_config":
      return getSiteConfig(orgId);

    case "list_annotations": {
      if (!args.slug) throw new Error("slug is required");
      if (!SLUG_RE.test(args.slug)) throw new Error("invalid slug format");
      return getAnnotations(orgId, args.slug);
    }

    case "list_open_annotations": {
      // Org-wide review queue: every annotation a human hasn't dispositioned
      // yet, grouped by page. This is the entry point for the
      // process-annotations workflow.
      const statusArg = args.status;
      const statusWhere =
        statusArg === "pending" || statusArg === "approved"
          ? statusArg
          : { in: ["pending", "approved"] };
      const openAnns = await db.annotation.findMany({
        where: { status: statusWhere, page: { orgId } },
        orderBy: { createdAt: "asc" },
        include: { page: { select: { slug: true, title: true } } },
      });
      const grouped = new Map<
        string,
        { slug: string; title: string; annotations: Array<Record<string, unknown>> }
      >();
      for (const a of openAnns) {
        const entry = grouped.get(a.page.slug) ?? {
          slug: a.page.slug,
          title: a.page.title,
          annotations: [],
        };
        entry.annotations.push({
          id: a.id,
          text: a.text,
          author: a.author,
          section: a.section,
          target: a.target,
          kind: a.kind,
          replacement: a.replacement,
          status: a.status,
          source: a.source,
          createdAt: a.createdAt,
        });
        grouped.set(a.page.slug, entry);
      }
      return {
        totalAnnotations: openAnns.length,
        pageCount: grouped.size,
        pages: [...grouped.values()],
        instructions:
          "For each page: read_page to get content + contentHash, apply 'edit'-kind annotations (replace target with replacement) and judge 'note'-kind feedback, write the page back, then update_annotation with status 'incorporated' (or 'ignored' with a reason annotation). See the 'Workflow — Process Annotations' page for the full procedure.",
      };
    }

    case "flag_page": {
      // Agent proposes, human disposes: flags queue a cleanup decision with
      // evidence; nothing is archived or deleted until a human acts on the
      // Cleanup view.
      if (!args.slug) throw new Error("slug is required");
      if (!SLUG_RE.test(args.slug)) throw new Error("invalid slug format");
      const FLAG_ACTIONS = ["archive", "delete", "merge", "supersede"];
      const FLAG_REASONS = ["shipped-not-closed", "superseded", "stale", "duplicate", "one-off-expired"];
      const FLAG_CONFIDENCE = ["high", "medium", "low"];
      if (!args.action || !FLAG_ACTIONS.includes(args.action)) {
        throw new Error(`action must be one of: ${FLAG_ACTIONS.join(", ")}`);
      }
      if (!args.reason || !FLAG_REASONS.includes(args.reason)) {
        throw new Error(`reason must be one of: ${FLAG_REASONS.join(", ")}`);
      }
      if (!args.evidence) throw new Error("evidence is required — cite what you checked (repo paths, dates, task state)");
      if (args.confidence && !FLAG_CONFIDENCE.includes(args.confidence)) {
        throw new Error("confidence must be high, medium, or low");
      }
      if (args.action === "supersede" && !args.superseded_by) {
        throw new Error("superseded_by (slug of the replacing page) is required when action is supersede");
      }
      if (args.superseded_by && !SLUG_RE.test(args.superseded_by)) {
        throw new Error("invalid superseded_by slug format");
      }
      const flagPage = await db.page.findUnique({
        where: { orgId_slug: { orgId, slug: args.slug } },
        select: { id: true, status: true },
      });
      if (!flagPage) throw new Error(`page not found: ${args.slug}`);
      if (flagPage.status === "archived") throw new Error(`page is already archived: ${args.slug}`);
      // A kept (dismissed) flag is a human decision — don't re-file the same
      // proposal on a later sweep.
      const dismissed = await db.pageFlag.findFirst({
        where: { pageId: flagPage.id, status: "kept", reason: args.reason },
        orderBy: { resolvedAt: "desc" },
      });
      if (dismissed) {
        return {
          ok: false,
          skipped: true,
          message: `A ${args.reason} flag on this page was dismissed by a human on ${dismissed.resolvedAt?.toISOString().slice(0, 10)} — not re-filing. Use a different reason with new evidence if circumstances changed.`,
        };
      }
      const existingFlag = await db.pageFlag.findFirst({
        where: { pageId: flagPage.id, status: "pending" },
      });
      const flag = await db.pageFlag.create({
        data: {
          pageId: flagPage.id,
          action: args.action,
          reason: args.reason,
          evidence: args.evidence,
          supersededBy: args.superseded_by ?? null,
          confidence: args.confidence ?? "medium",
          actorId,
        },
      });
      await db.$executeRaw`UPDATE pages SET status = 'flagged' WHERE id = ${flagPage.id} AND status = 'active'`;
      logAudit({ orgId, action: "page.flag", resourceType: "page", resourceId: args.slug, actorType: "apikey", actorId, metadata: { action: args.action, reason: args.reason, confidence: args.confidence } });
      return { ok: true, flagId: flag.id, note: existingFlag ? "page already had a pending flag — both are queued, latest wins for display" : undefined };
    }

    case "list_flags": {
      // Default: everything a future sweep needs to avoid duplicate work —
      // pending flags plus human dispositions (kept/snoozed).
      const flagStatus = args.status; // pending | kept | snoozed | resolved | all
      const flagWhere: Record<string, unknown> = { page: { orgId } };
      if (flagStatus && flagStatus !== "all") flagWhere.status = flagStatus;
      const flags = await db.pageFlag.findMany({
        where: flagWhere,
        orderBy: { createdAt: "desc" },
        include: { page: { select: { slug: true, title: true, status: true } } },
      });
      return flags.map((f) => ({
        id: f.id,
        slug: f.page.slug,
        title: f.page.title,
        pageStatus: f.page.status,
        action: f.action,
        reason: f.reason,
        evidence: f.evidence,
        supersededBy: f.supersededBy,
        confidence: f.confidence,
        flaggedBy: f.actorId,
        flaggedAt: f.createdAt,
        status: f.status,
        snoozeUntil: f.snoozeUntil,
        resolvedBy: f.resolvedBy,
        resolvedAt: f.resolvedAt,
      }));
    }

    case "get_review_queue": {
      // Rules-scoped queue: getReviewQueue already excludes locked folders
      // unconditionally, and only lets a never-trusted page in when an
      // approval rule governs its scope (trustedBehind pages always
      // qualify). Reused as-is, never reimplemented here.
      const queue = await getReviewQueue(orgId, userId);
      if (queue.length === 0) return [];

      const slugs = queue.map((r) => r.slug);
      const [grPages, grFolders, grOrg] = await Promise.all([
        db.page.findMany({
          where: { orgId, slug: { in: slugs } },
          select: {
            slug: true,
            folderId: true,
            rules: true,
            trustedVersionId: true,
            versions: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true } },
          },
        }),
        db.folder.findMany({ where: { orgId }, select: { id: true, parentId: true, name: true, rules: true } }),
        db.organization.findUnique({ where: { id: orgId }, select: { rules: true } }),
      ]);
      const grPageBySlug = new Map(grPages.map((p) => [p.slug, p]));
      const grResolveApprovalRule = makeApprovalRuleResolver(grFolders, grOrg?.rules);

      const rows = await Promise.all(
        queue.map(async (r) => {
          const p = grPageBySlug.get(r.slug);
          const resolved = p ? grResolveApprovalRule(p.folderId, p.rules) : null;
          const approvalRule = resolved ? await describeApprovalRule(orgId, resolved.rule) : null;
          return {
            slug: r.slug,
            title: r.title,
            folderName: r.folderName,
            neverTrusted: r.neverTrusted,
            versionsBehind: r.versionsBehind,
            trustedVersionId: p?.trustedVersionId ?? null,
            latestVersionId: p?.versions[0]?.id ?? null,
            approvalRule,
          };
        })
      );
      return rows;
    }

    case "get_component_reference": {
      const refPath = path.join(process.cwd(), "docs", "agents-reference.md");
      if (!fs.existsSync(refPath)) {
        return {
          error: "component reference not found — run the setup script",
        };
      }
      // `ref` isn't a real renderer component (it never reaches the
      // renderer — it's expanded server-side before render), so it isn't in
      // the generated schema doc above. Appended here instead of hand-edited
      // into that generated file.
      const sharedComponentsNote =
        "\n\n## ref (shared components)\n\nNot a rendered component — expanded server-side before the page renders. Embeds another page's `components` array by slug:\n\n```yaml\n- type: ref\n  component: <slug-of-a-pageType-component-page>\n```\n\nThe target page must declare `pageType: component`. Edits to the target fan out to every page that embeds it once the target's new version is trusted; a page that only holds a ref has nothing else to patch.";
      return { content: fs.readFileSync(refPath, "utf-8") + sharedComponentsNote };
    }

    case "list_folders": {
      const folders = await db.folder.findMany({
        where: { orgId },
        orderBy: { name: "asc" },
        include: { _count: { select: { pages: true } } },
      });
      return folders.map((f) => ({
        id: f.id,
        name: f.name,
        parentId: f.parentId,
        visibility: f.visibility,
        pageCount: f._count.pages,
      }));
    }

    case "get_folder_structure": {
      const [gfsFolders, gfsPages] = await Promise.all([
        db.folder.findMany({ where: { orgId }, orderBy: { name: "asc" }, include: { _count: { select: { pages: true } } } }),
        listPages(orgId, userId),
      ]);
      return {
        folders: gfsFolders.map((f) => ({ id: f.id, name: f.name, parentId: f.parentId, pageCount: f._count.pages })),
        pages: gfsPages.map((p) => ({ slug: p.slug, title: p.title, folderId: p.folderId })),
      };
    }

    case "create_folder": {
      if (!args.name) throw new Error("name is required");
      const cfVisibility = args.visibility ?? "org";
      if (cfVisibility !== "private" && cfVisibility !== "org") {
        throw new Error("visibility must be 'private' or 'org'");
      }
      let parentName: string | null = null;
      if (args.parent_id) {
        const parent = await db.folder.findFirst({ where: { id: args.parent_id, orgId } });
        if (!parent) throw new Error(`parent folder not found: ${args.parent_id}`);
        parentName = parent.name;
      }
      const existingFolder = await db.folder.findFirst({ where: { orgId, name: args.name, parentId: args.parent_id ?? null } });
      if (existingFolder) throw new Error(`folder "${args.name}" already exists${parentName ? ` under "${parentName}"` : " at root"}`);
      let cfRules: Prisma.InputJsonValue | undefined;
      if (args.rules) {
        try { cfRules = JSON.parse(args.rules) as Prisma.InputJsonValue; } catch { throw new Error("rules must be valid JSON"); }
      }
      const newFolder = await db.folder.create({
        data: { orgId, name: args.name, visibility: cfVisibility, createdBy: actorId, parentId: args.parent_id ?? null, ...(cfRules !== undefined ? { rules: cfRules } : {}) },
      });
      logAudit({ orgId, action: "folder.create", resourceType: "folder", resourceId: newFolder.id, actorType: "apikey", actorId, metadata: { name: args.name, parentId: args.parent_id, parentName } });
      return { ok: true, id: newFolder.id, name: newFolder.name, parentId: args.parent_id ?? null, parentName, visibility: cfVisibility };
    }

    case "update_folder": {
      if (!args.id) throw new Error("id is required");
      const ufFolder = await db.folder.findFirst({ where: { id: args.id, orgId } });
      if (!ufFolder) throw new Error(`folder not found: ${args.id}`);
      if (args.parent_id) {
        const parent = await db.folder.findFirst({ where: { id: args.parent_id, orgId } });
        if (!parent) throw new Error(`parent folder not found: ${args.parent_id}`);
        const wouldCycle = await detectFolderCycle(orgId, args.id, args.parent_id);
        if (wouldCycle) throw new Error("cannot reparent: would create a cycle");
      }
      if (args.visibility && args.visibility !== "private" && args.visibility !== "org") {
        throw new Error("visibility must be 'private' or 'org'");
      }
      if (args.visibility) {
        const pagesInFolder = await db.page.findMany({
          where: { folderId: args.id },
          select: { slug: true, visibility: true },
        });
        const violating = pagesInFolder.filter((p) => {
          try { checkFolderBoundary(p.visibility ?? "org", args.visibility); return false; } catch { return true; }
        });
        if (violating.length > 0) {
          throw new Error(
            `cannot set folder to "${args.visibility}" — ${violating.length} page(s) have lower visibility: ${violating.map((p) => p.slug).join(", ")}`
          );
        }
      }
      let ufRulesParsed: Prisma.InputJsonValue | undefined;
      if (args.rules !== undefined) {
        try { ufRulesParsed = JSON.parse(args.rules) as Prisma.InputJsonValue; } catch { throw new Error("rules must be valid JSON"); }
      }
      const ufData: Record<string, unknown> = {};
      if (args.name !== undefined) ufData.name = args.name;
      if (args.parent_id !== undefined) ufData.parentId = args.parent_id || null;
      if (args.visibility !== undefined) ufData.visibility = args.visibility;
      if (ufRulesParsed !== undefined) ufData.rules = ufRulesParsed;
      await db.folder.update({ where: { id: args.id }, data: ufData });
      logAudit({ orgId, action: "folder.update", resourceType: "folder", resourceId: args.id, actorType: "apikey", actorId, metadata: { name: args.name, parentId: args.parent_id, visibility: args.visibility, hasRules: !!ufRulesParsed } });
      return { ok: true, id: args.id };
    }

    case "get_versions": {
      if (!args.slug) throw new Error("slug is required");
      if (!SLUG_RE.test(args.slug)) throw new Error("invalid slug format");
      const page = await db.page.findUnique({
        where: { orgId_slug: { orgId, slug: args.slug } },
        include: {
          versions: {
            orderBy: { createdAt: "desc" },
            take: Math.min(Math.max(parseInt(args.limit || "10", 10) || 10, 1), 50),
            select: { id: true, contentHash: true, createdBy: true, createdAt: true },
          },
        },
      });
      if (!page) throw new Error(`page not found: ${args.slug}`);
      return page.versions;
    }

    case "validate_page": {
      if (!args.slug) throw new Error("slug is required");
      if (!SLUG_RE.test(args.slug)) throw new Error("invalid slug format");
      if (!args.content) throw new Error("content (YAML) is required");
      const validateUnsupported = checkUnsupportedComponents(args.content);
      const errors = [...validateUnsupported, ...await validateContent(orgSlug, args.slug, args.content)];
      return { valid: errors.length === 0, errors: errors.map((e) => e.message) };
    }

    case "create_page": {
      if (!args.slug) throw new Error("slug is required");
      if (!SLUG_RE.test(args.slug)) throw new Error("invalid slug format");
      if (!args.content) throw new Error("content (YAML) is required");
      const unsupported = checkUnsupportedComponents(args.content);
      if (unsupported.length > 0) {
        throw new Error(unsupported.map((e) => e.message).join("; "));
      }
      const existing = await db.page.findUnique({
        where: { orgId_slug: { orgId, slug: args.slug } },
      });
      if (existing) throw new Error(`page already exists: ${args.slug}`);
      const createValidation = await validateContent(orgSlug, args.slug, args.content);
      if (createValidation.length > 0) {
        const messages = createValidation.map((e) => e.message).join("; ");
        throw new Error(invalidContentMessage(messages));
      }
      const cpVis = args.visibility ?? mcpDefaultVisibility();
      if (!["private", "org", "public"].includes(cpVis)) throw new Error("visibility must be private, org, or public");
      if (args.folder_id) {
        const cpFolder = await db.folder.findFirst({ where: { id: args.folder_id, orgId } });
        if (!cpFolder) throw new Error(`folder not found: ${args.folder_id}`);
        if (cpFolder.locked) throw new Error("cannot create: folder is curata-managed (view + copy only)");
        checkFolderBoundary(cpVis, cpFolder.visibility);
      }
      let cpPageRules: unknown;
      if (args.rules) {
        try { cpPageRules = JSON.parse(args.rules); } catch { throw new Error("rules must be valid JSON"); }
      }
      let cpConceptInputs: ConceptInput[] | undefined;
      if (args.concepts) {
        try { cpConceptInputs = JSON.parse(args.concepts); } catch { throw new Error("concepts must be valid JSON"); }
      }
      const cpRules = await resolveRules(orgId, args.folder_id ?? null, cpPageRules);
      const cpAllRules = [...cpRules.inherited, ...cpRules.page];
      const cpRuleCheck = validateContentRules(args.content, cpAllRules);
      if (cpRuleCheck.violations.length > 0) {
        throw new Error(`content rule violation: ${cpRuleCheck.violations.map((v) => `[${v.scope}] ${v.message} (matched: ${v.matches?.join(", ")})`).join("; ")}`);
      }
      // Required-components: a brand-new page has no existing concepts, so
      // the resulting count is whatever this call's `concepts` arg attaches.
      const cpRcRules = await resolveRequiredComponentsRules(orgId, args.folder_id ?? null, cpPageRules);
      const cpAllRcRules = [...cpRcRules.inherited, ...cpRcRules.page];
      const cpResultingConceptCount = projectConceptTerms([], cpConceptInputs).size;
      const cpRcViolations = validateRequiredComponents(args.content, cpResultingConceptCount, cpAllRcRules);
      if (cpRcViolations.length > 0) {
        throw new Error(`required-components rule violation: ${cpRcViolations.map((v) => `[${v.scope}] ${v.message}`).join("; ")}`);
      }
      // Capture gate: only fires when the declared pageType's resolved rule
      // sets captureRequired — a no-op for every other page.
      enforceCaptureGate({
        orgId,
        content: args.content,
        resolvedRules: cpAllRcRules,
        captureToken: args.capture_token,
        dedupAck: args.dedup_ack,
      });
      const createResult = await writePage(orgId, orgSlug, args.slug, args.content, userId || "agent", undefined, undefined, cpVis);
      if (!createResult.ok) throw new Error(createResult.error);
      if (cpConceptInputs || args.links) {
        const cpPage = await db.page.findUnique({
          where: { orgId_slug: { orgId, slug: args.slug } },
          select: { id: true },
        });
        if (cpPage) {
          if (cpConceptInputs) {
            await upsertConcepts(cpPage.id, cpConceptInputs, actorId);
          }
          if (args.links) {
            const linkInputs: LinkInput[] = JSON.parse(args.links);
            await upsertLinks(orgId, cpPage.id, linkInputs, actorId);
          }
        }
      }
      if (args.folder_id || cpPageRules !== undefined) {
        const cpUpdate: Record<string, unknown> = {};
        if (args.folder_id) cpUpdate.folderId = args.folder_id;
        if (cpPageRules !== undefined) cpUpdate.rules = cpPageRules;
        await db.page.update({
          where: { orgId_slug: { orgId, slug: args.slug } },
          data: cpUpdate,
        });
      }
      const cpResult: Record<string, unknown> = { ...createResult };
      if (cpRuleCheck.warnings.length > 0) {
        cpResult.contentWarnings = cpRuleCheck.warnings.map((w) => ({
          scope: w.scope,
          message: w.message,
          matches: w.matches,
        }));
      }
      logAudit({
        orgId,
        action: "page.create",
        resourceType: "page",
        resourceId: args.slug,
        actorType: "apikey",
        actorId,
        metadata: { slug: args.slug, folderId: args.folder_id },
      });
      return cpResult;
    }

    case "move_page": {
      if (!args.slug) throw new Error("slug is required");
      if (!SLUG_RE.test(args.slug)) throw new Error("invalid slug format");
      const movePage = await db.page.findUnique({
        where: { orgId_slug: { orgId, slug: args.slug } },
        include: { folder: { select: { name: true, locked: true } } },
      });
      if (!movePage) throw new Error(`page not found: ${args.slug}`);
      if ((movePage as unknown as { folder: { locked: boolean } | null }).folder?.locked) {
        throw new Error("cannot move: page is in a curata-managed folder (view + copy only)");
      }
      const folderId = args.folder_id || null;
      let targetFolderName: string | null = null;
      if (folderId) {
        const folder = await db.folder.findFirst({ where: { id: folderId, orgId } });
        if (!folder) throw new Error(`folder not found: ${folderId}`);
        if (folder.locked) throw new Error("cannot move: destination folder is curata-managed (view + copy only)");
        targetFolderName = folder.name;
        checkFolderBoundary(movePage.visibility ?? "org", folder.visibility);
      }
      const previousFolderId = movePage.folderId;
      const previousFolderName = (movePage as unknown as { folder: { name: string } | null }).folder?.name ?? null;
      if (previousFolderId === folderId) {
        return { ok: true, slug: args.slug, folderId, folderName: targetFolderName, note: "page was already in this folder — no change" };
      }
      await db.page.update({
        where: { id: movePage.id },
        data: { folderId },
      });
      logAudit({
        orgId,
        action: "page.move",
        resourceType: "page",
        resourceId: args.slug,
        actorType: "apikey",
        actorId,
        metadata: { slug: args.slug, folderId, folderName: targetFolderName, previousFolderId, previousFolderName },
      });
      return { ok: true, slug: args.slug, folderId, folderName: targetFolderName, previousFolderId, previousFolderName };
    }

    case "write_page": {
      if (!args.slug) throw new Error("slug is required");
      if (!SLUG_RE.test(args.slug)) throw new Error("invalid slug format");
      if (!args.content) throw new Error("content (YAML) is required");
      const writeUnsupported = checkUnsupportedComponents(args.content);
      if (writeUnsupported.length > 0) {
        throw new Error(writeUnsupported.map((e) => e.message).join("; "));
      }
      const validationErrors = await validateContent(orgSlug, args.slug, args.content);
      if (validationErrors.length > 0) {
        const messages = validationErrors.map((e) => e.message).join("; ");
        throw new Error(invalidContentMessage(messages));
      }
      const wpVis = args.visibility ?? mcpDefaultVisibility();
      if (!["private", "org", "public"].includes(wpVis)) throw new Error("visibility must be private, org, or public");
      const wpExisting = await db.page.findUnique({
        where: { orgId_slug: { orgId, slug: args.slug } },
        select: { id: true, folderId: true, rules: true, folder: { select: { visibility: true } } },
      });
      if (args.folder_id) {
        const folder = await db.folder.findFirst({ where: { id: args.folder_id, orgId } });
        if (!folder) throw new Error(`folder not found: ${args.folder_id}`);
        checkFolderBoundary(wpVis, folder.visibility);
      } else if (wpExisting?.folder && args.visibility) {
        checkFolderBoundary(args.visibility, wpExisting.folder.visibility);
      }
      let wpPageRules: unknown;
      if (args.rules !== undefined) {
        try { wpPageRules = JSON.parse(args.rules); } catch { throw new Error("rules must be valid JSON"); }
      }
      const wpFolderId = args.folder_id ?? wpExisting?.folderId ?? null;
      const wpRulesJson = wpPageRules !== undefined ? wpPageRules : wpExisting?.rules;
      const wpRules = await resolveRules(orgId, wpFolderId, wpRulesJson);
      const wpAllRules = [...wpRules.inherited, ...wpRules.page];
      const wpRuleCheck = validateContentRules(args.content, wpAllRules);
      if (wpRuleCheck.violations.length > 0) {
        throw new Error(`content rule violation: ${wpRuleCheck.violations.map((v) => `[${v.scope}] ${v.message} (matched: ${v.matches?.join(", ")})`).join("; ")}`);
      }
      let wpConceptInputs: ConceptInput[] | undefined;
      if (args.concepts) {
        try { wpConceptInputs = JSON.parse(args.concepts); } catch { throw new Error("concepts must be valid JSON"); }
      }
      // Required-components: validate the RESULT of this write (existing
      // concepts merged with whatever this call's `concepts` arg changes),
      // not just the incoming diff — matches "validate the result, not the
      // ops" for patch_page below.
      const wpRcRules = await resolveRequiredComponentsRules(orgId, wpFolderId, wpRulesJson);
      const wpAllRcRules = [...wpRcRules.inherited, ...wpRcRules.page];
      const wpExistingConceptTerms = wpExisting?.id ? (await getPageConcepts(wpExisting.id)).map((c) => c.term) : [];
      const wpResultingConceptCount = projectConceptTerms(wpExistingConceptTerms, wpConceptInputs).size;
      const wpRcViolations = validateRequiredComponents(args.content, wpResultingConceptCount, wpAllRcRules);
      if (wpRcViolations.length > 0) {
        throw new Error(`required-components rule violation: ${wpRcViolations.map((v) => `[${v.scope}] ${v.message}`).join("; ")}`);
      }
      // Capture gate only applies when write_page is creating a brand-new
      // page — editing an existing one is never gated, dedup only guards
      // against a fresh near-duplicate.
      if (!wpExisting) {
        enforceCaptureGate({
          orgId,
          content: args.content,
          resolvedRules: wpAllRcRules,
          captureToken: args.capture_token,
          dedupAck: args.dedup_ack,
        });
      }
      const writeResult = await writePage(
        orgId,
        orgSlug,
        args.slug,
        args.content,
        userId || "agent",
        args.expected_hash,
        undefined,
        wpVis
      );
      if (!writeResult.ok) {
        throw new Error(writeResult.error);
      }
      const wpUpdate: Record<string, unknown> = {};
      if (args.visibility) wpUpdate.visibility = args.visibility;
      if (args.folder_id) wpUpdate.folderId = args.folder_id;
      if (wpPageRules !== undefined) wpUpdate.rules = wpPageRules;
      if (Object.keys(wpUpdate).length > 0) {
        await db.page.update({
          where: { orgId_slug: { orgId, slug: args.slug } },
          data: wpUpdate,
        });
      }
      if (wpConceptInputs || args.links) {
        const wpPage = await db.page.findUnique({
          where: { orgId_slug: { orgId, slug: args.slug } },
          select: { id: true },
        });
        if (wpPage) {
          if (wpConceptInputs) {
            await upsertConcepts(wpPage.id, wpConceptInputs, actorId);
          }
          if (args.links) {
            const linkInputs: LinkInput[] = JSON.parse(args.links);
            await upsertLinks(orgId, wpPage.id, linkInputs, actorId);
          }
        }
      }
      logAudit({
        orgId,
        action: "page.write",
        resourceType: "page",
        resourceId: args.slug,
        actorType: "apikey",
        actorId,
        metadata: { slug: args.slug },
      });
      const wpPageAfter = await db.page.findUnique({
        where: { orgId_slug: { orgId, slug: args.slug } },
        select: { folderId: true, rules: true },
      });
      if (wpPageAfter) {
        const { mode: wpTrustMode } = await resolveEffectiveTrustMode(orgId, wpPageAfter.folderId, wpPageAfter.rules);
        if (wpTrustMode === "locked") {
          const wpEligible = await resolveTrustEligibility(orgId, userId, args.slug);
          if (wpEligible) {
            const wpLatest = await db.pageVersion.findFirst({
              where: { page: { orgId, slug: args.slug } },
              orderBy: { createdAt: "desc" },
              select: { id: true },
            });
            if (wpLatest) await markTrusted(orgId, args.slug, wpLatest.id, userId || "agent");
          }
        }
      }
      const wpResult: Record<string, unknown> = { ...writeResult };
      if (wpRuleCheck.warnings.length > 0) {
        wpResult.contentWarnings = wpRuleCheck.warnings.map((w) => ({
          scope: w.scope,
          message: w.message,
          matches: w.matches,
        }));
      }
      return wpResult;
    }

    case "annotate_page": {
      if (!args.slug) throw new Error("slug is required");
      if (!SLUG_RE.test(args.slug)) throw new Error("invalid slug format");
      if (!args.text) throw new Error("text is required");
      // Provenance: plain agent annotations default to "agent"; a review
      // pre-screen finding sets source: "prescreen" so it's distinguishable
      // in list_open_annotations/list_annotations without any schema change
      // (source is a plain string column, not an enum).
      if (args.source && args.source !== "agent" && args.source !== "prescreen") {
        throw new Error('source must be "agent" or "prescreen"');
      }
      const apSource = args.source === "prescreen" ? "prescreen" : "agent";
      const annotation = await saveAnnotation(
        orgId,
        orgSlug,
        args.slug,
        args.text,
        args.author || "agent",
        args.section,
        args.target,
        (args.kind as "note" | "edit") || undefined,
        args.replacement,
        apSource
      );
      logAudit({
        orgId,
        action: "annotation.create",
        resourceType: "annotation",
        resourceId: (annotation as { id?: string }).id ?? args.slug,
        actorType: "apikey",
        actorId,
        metadata: { slug: args.slug, section: args.section, kind: args.kind },
      });
      return annotation;
    }

    case "update_annotation": {
      if (!args.slug) throw new Error("slug is required");
      if (!SLUG_RE.test(args.slug)) throw new Error("invalid slug format");
      if (!args.id) throw new Error("id is required");
      if (!args.status) throw new Error("status is required");
      if (
        args.status !== "approved" &&
        args.status !== "incorporated" &&
        args.status !== "ignored"
      ) {
        throw new Error(
          "status must be 'approved', 'incorporated', or 'ignored'"
        );
      }
      const updated = await updateAnnotationStatus(
        orgId,
        orgSlug,
        args.slug,
        args.id,
        args.status
      );
      if (!updated) throw new Error("annotation not found");
      logAudit({
        orgId,
        action: "annotation.update",
        resourceType: "annotation",
        resourceId: args.id,
        actorType: "apikey",
        actorId,
        metadata: { slug: args.slug, status: args.status },
      });
      return { ok: true };
    }

    case "patch_page": {
      if (!args.slug) throw new Error("slug is required");
      if (!SLUG_RE.test(args.slug)) throw new Error("invalid slug format");
      if (!args.operations && !args.concepts && !args.links) {
        throw new Error("nothing to do — provide operations, concepts, or links");
      }

      if (!args.operations) {
        // Tag/link-only patch: no content rewrite, no hash check needed.
        const tagPage = await db.page.findUnique({
          where: { orgId_slug: { orgId, slug: args.slug } },
          select: { id: true, folderId: true, rules: true },
        });
        if (!tagPage) throw new Error(`page not found: ${args.slug}`);
        let tagConceptInputs: ConceptInput[] | undefined;
        if (args.concepts) {
          try { tagConceptInputs = JSON.parse(args.concepts); } catch { throw new Error("concepts must be valid JSON"); }
        }
        if (tagConceptInputs) {
          // A concepts-only patch can still trip a requireConcepts rule
          // (e.g. removing the last tag) even though content is unchanged.
          const tagRcRules = await resolveRequiredComponentsRules(orgId, tagPage.folderId, tagPage.rules);
          const tagAllRcRules = [...tagRcRules.inherited, ...tagRcRules.page];
          if (tagAllRcRules.length > 0) {
            const tagCurrent = await readPageYaml(orgId, args.slug);
            const tagExistingConceptTerms = (await getPageConcepts(tagPage.id)).map((c) => c.term);
            const tagResultingConceptCount = projectConceptTerms(tagExistingConceptTerms, tagConceptInputs).size;
            const tagRcViolations = tagCurrent ? validateRequiredComponents(tagCurrent.yaml, tagResultingConceptCount, tagAllRcRules) : [];
            if (tagRcViolations.length > 0) {
              throw new Error(`required-components rule violation: ${tagRcViolations.map((v) => `[${v.scope}] ${v.message}`).join("; ")}`);
            }
          }
          await upsertConcepts(tagPage.id, tagConceptInputs, actorId);
        }
        if (args.links) {
          const linkInputs: LinkInput[] = JSON.parse(args.links);
          await upsertLinks(orgId, tagPage.id, linkInputs, actorId);
        }
        logAudit({
          orgId,
          action: "page.patch",
          resourceType: "page",
          resourceId: args.slug,
          actorType: "apikey",
          actorId,
          metadata: { slug: args.slug, operationCount: 0, tagsOnly: true },
        });
        return { message: `Patched "${args.slug}" (concepts/links only)` };
      }

      if (!args.expected_hash) throw new Error("expected_hash is required when operations are given");

      let operations: PatchOperation[];
      try {
        operations = JSON.parse(args.operations);
      } catch {
        throw new Error("operations must be valid JSON");
      }
      if (!Array.isArray(operations)) throw new Error("operations must be an array");

      const current = await readPageYaml(orgId, args.slug);
      if (!current) throw new Error(`page not found: ${args.slug}`);

      if (current.contentHash !== args.expected_hash) {
        throw new Error(`conflict: page was modified since last read (current hash: ${current.contentHash})`);
      }

      const parsed = yaml.load(current.yaml) as Record<string, unknown>;
      if (!Array.isArray(parsed.components)) {
        throw new Error("page has no components array — use write_page instead");
      }

      parsed.components = ensureComponentIds(parsed.components as Record<string, unknown>[]);
      const patched = applyPatchOperations(parsed as { components: Record<string, unknown>[]; [k: string]: unknown }, operations);
      patched.components = ensureComponentIds(patched.components);

      const newYaml = yaml.dump(patched, { lineWidth: -1, noRefs: true });

      const patchUnsupported = checkUnsupportedComponents(newYaml);
      if (patchUnsupported.length > 0) {
        throw new Error(patchUnsupported.map((e) => e.message).join("; "));
      }
      const patchValidation = await validateContent(orgSlug, args.slug, newYaml);
      if (patchValidation.length > 0) {
        throw new Error(`invalid after patch: ${patchValidation.map((e) => e.message).join("; ")}`);
      }

      const ppExisting = await db.page.findUnique({
        where: { orgId_slug: { orgId, slug: args.slug } },
        select: { id: true, folderId: true, rules: true },
      });
      const ppRules = await resolveRules(orgId, ppExisting?.folderId ?? null, ppExisting?.rules);
      const ppAllRules = [...ppRules.inherited, ...ppRules.page];
      const ppRuleCheck = validateContentRules(newYaml, ppAllRules);
      if (ppRuleCheck.violations.length > 0) {
        throw new Error(`content rule violation: ${ppRuleCheck.violations.map((v) => `[${v.scope}] ${v.message} (matched: ${v.matches?.join(", ")})`).join("; ")}`);
      }

      let ppConceptInputs: ConceptInput[] | undefined;
      if (args.concepts) {
        try { ppConceptInputs = JSON.parse(args.concepts); } catch { throw new Error("concepts must be valid JSON"); }
      }
      // Required-components validates newYaml — the RESULT of applying the
      // patch operations — never the ops themselves, so a patch that removes
      // a required section (or an op sequence that nets out to one missing)
      // is rejected the same as a from-scratch write with that section gone.
      const ppRcRules = await resolveRequiredComponentsRules(orgId, ppExisting?.folderId ?? null, ppExisting?.rules);
      const ppAllRcRules = [...ppRcRules.inherited, ...ppRcRules.page];
      const ppExistingConceptTerms = ppExisting ? (await getPageConcepts(ppExisting.id)).map((c) => c.term) : [];
      const ppResultingConceptCount = projectConceptTerms(ppExistingConceptTerms, ppConceptInputs).size;
      const ppRcViolations = validateRequiredComponents(newYaml, ppResultingConceptCount, ppAllRcRules);
      if (ppRcViolations.length > 0) {
        throw new Error(`required-components rule violation: ${ppRcViolations.map((v) => `[${v.scope}] ${v.message}`).join("; ")}`);
      }

      const patchResult = await writePage(orgId, orgSlug, args.slug, newYaml, "agent", current.contentHash);
      if (!patchResult.ok) throw new Error(patchResult.error);

      if (ppConceptInputs || args.links) {
        if (ppExisting) {
          if (ppConceptInputs) {
            await upsertConcepts(ppExisting.id, ppConceptInputs, actorId);
          }
          if (args.links) {
            const linkInputs: LinkInput[] = JSON.parse(args.links);
            await upsertLinks(orgId, ppExisting.id, linkInputs, actorId);
          }
        }
      }
      logAudit({
        orgId,
        action: "page.patch",
        resourceType: "page",
        resourceId: args.slug,
        actorType: "apikey",
        actorId,
        metadata: { slug: args.slug, operationCount: operations.length },
      });
      const ppResult: Record<string, unknown> = { ...patchResult };
      if (ppRuleCheck.warnings.length > 0) {
        ppResult.contentWarnings = ppRuleCheck.warnings.map((w) => ({
          scope: w.scope,
          message: w.message,
          matches: w.matches,
        }));
      }
      return ppResult;
    }

    case "list_workflows": {
      const lwFolders = await db.folder.findMany({ where: { orgId }, select: { id: true, name: true } });
      const lwFolder = lwFolders.find((f) => f.name.toLowerCase() === "workflows");
      if (!lwFolder) return [];
      const lwPages = await db.page.findMany({
        where: { orgId, folderId: lwFolder.id },
        include: { versions: { orderBy: { createdAt: "desc" }, take: 1, select: { yamlContent: true } } },
      });
      return lwPages.map((p) => {
        let trigger: string | null = null;
        let description: string | null = null;
        try {
          const raw = p.versions[0]?.yamlContent ?? "";
          const parsed = yaml.load(raw) as Record<string, unknown>;
          const components = Array.isArray(parsed?.components) ? parsed.components as Record<string, unknown>[] : [];
          // Triggers and descriptions usually live one level down, inside a
          // section's components — scan both depths.
          const flat: Record<string, unknown>[] = [];
          for (const comp of components) {
            flat.push(comp);
            if (comp.type === "section" && Array.isArray(comp.components)) {
              flat.push(...(comp.components as Record<string, unknown>[]));
            }
          }
          for (const comp of flat) {
            if (!trigger && comp.type === "definition_list" && Array.isArray(comp.items)) {
              const triggerItem = (comp.items as Record<string, unknown>[]).find(
                (item) => typeof item.term === "string" && item.term.toLowerCase() === "trigger"
              );
              if (triggerItem) trigger = String(triggerItem.definition ?? "");
            }
            if (!description && comp.type === "callout" && comp.body) {
              description = String(comp.body);
            }
          }
        } catch {
          // best-effort extraction
        }
        return { slug: p.slug, title: p.title, trigger, description };
      });
    }

    case "list_templates": {
      const ltFolders = await db.folder.findMany({ where: { orgId }, select: { id: true, name: true } });
      const ltFolder = ltFolders.find((f) => f.name.toLowerCase() === "templates");
      if (!ltFolder) return [];
      const ltPages = await db.page.findMany({
        where: { orgId, folderId: ltFolder.id, status: { not: "archived" } },
        include: { versions: { orderBy: { createdAt: "desc" }, take: 1, select: { yamlContent: true } } },
      });
      return ltPages.map((p) => {
        const raw = p.versions[0]?.yamlContent ?? "";
        const variables: string[] = [];
        const seen = new Set<string>();
        for (const match of raw.matchAll(/\{\{(\w+)\}\}/g)) {
          if (!seen.has(match[1])) {
            seen.add(match[1]);
            variables.push(match[1]);
          }
        }
        return { slug: p.slug, title: p.title, variables };
      });
    }

    case "create_from_template": {
      if (!args.template_slug) throw new Error("template_slug is required");
      if (!SLUG_RE.test(args.template_slug)) throw new Error("invalid template_slug format");
      if (!args.target_slug) throw new Error("target_slug is required");
      if (!SLUG_RE.test(args.target_slug)) throw new Error("invalid target_slug format");

      const tmplResult = await readPageYaml(orgId, args.template_slug);
      if (!tmplResult) throw new Error(`template not found: ${args.template_slug}`);

      let variables: Record<string, string> = {};
      if (args.variables) {
        try {
          variables = JSON.parse(args.variables);
        } catch {
          throw new Error("variables must be valid JSON");
        }
      }

      const interpolated = tmplResult.yaml.replace(/\{\{(\w+)\}\}/g, (_, key: string) => variables[key] ?? `{{${key}}}`);

      const cftUnsupported = checkUnsupportedComponents(interpolated);
      if (cftUnsupported.length > 0) {
        throw new Error(cftUnsupported.map((e) => e.message).join("; "));
      }
      const cftValidation = await validateContent(orgSlug, args.target_slug, interpolated);
      if (cftValidation.length > 0) {
        throw new Error(`invalid after interpolation: ${cftValidation.map((e) => e.message).join("; ")}`);
      }

      const existing = await db.page.findUnique({ where: { orgId_slug: { orgId, slug: args.target_slug } } });
      if (existing) throw new Error(`page already exists: ${args.target_slug}`);

      const cftResult = await writePage(orgId, orgSlug, args.target_slug, interpolated, "agent");
      if (!cftResult.ok) throw new Error(cftResult.error);

      if (args.folder_id) {
        const folder = await db.folder.findFirst({ where: { id: args.folder_id, orgId } });
        if (!folder) throw new Error(`folder not found: ${args.folder_id}`);
        await db.page.update({
          where: { orgId_slug: { orgId, slug: args.target_slug } },
          data: { folderId: args.folder_id },
        });
      }

      logAudit({
        orgId,
        action: "page.create",
        resourceType: "page",
        resourceId: args.target_slug,
        actorType: "apikey",
        actorId,
        metadata: { slug: args.target_slug, templateSlug: args.template_slug, folderId: args.folder_id },
      });
      return { ...cftResult, slug: args.target_slug };
    }

    case "capture_thread": {
      if (!args.content) throw new Error("content is required");
      if (Buffer.byteLength(args.content, "utf8") > CAPTURE_CONTENT_MAX_BYTES) {
        throw new Error(`content is too large (${Buffer.byteLength(args.content, "utf8")} bytes) — capture_thread accepts at most ${CAPTURE_CONTENT_MAX_BYTES} bytes (200KB); trim the thread before capturing`);
      }
      let ctSource: unknown;
      if (args.source) {
        try { ctSource = JSON.parse(args.source); } catch { throw new Error("source must be valid JSON"); }
      }
      const ctPageType = args.page_type || "captured-qa";
      const ctFolderId = args.folder_id || null;

      // Orgs created before required-components existed never got the
      // default captured-qa rule; backfill here so the gate and checklist
      // work everywhere, not just on fresh orgs.
      await ensureDefaultRequiredComponentsRules(orgId);

      const dedupCandidates = await findCaptureDedupCandidates(orgId, args.content, userId);

      // Blocking content rules the eventual create_page/write_page will
      // enforce, surfaced now so an agent learns the write constraints
      // (no em dashes, no e.g./i.e., etc.) before it drafts content, not
      // from a rejected write. Bounded to id/text/scope and to block-mode
      // rules only — a summary, not the full resolved rule set (list_rules
      // still exists for that).
      const ctContentRules = await resolveRules(orgId, ctFolderId, undefined);
      const blockingContentRules = [...ctContentRules.inherited, ...ctContentRules.page]
        .filter((r) => r.mode === "block")
        .map((r) => ({ id: r.id, text: r.text, scope: r.scope }));

      const ctRcRules = await resolveRequiredComponentsRules(orgId, ctFolderId, undefined);
      const ctAllRcRules = [...ctRcRules.inherited, ...ctRcRules.page];
      const ctApplicable = ctAllRcRules.filter((r) => r.pageType === ctPageType);
      const checklist = ctApplicable.length > 0
        ? {
            pageType: ctPageType,
            requiredComponentIds: [...new Set(ctApplicable.flatMap((r) => r.requiredComponentIds))],
            requiredFields: [...new Set(ctApplicable.flatMap((r) => r.requiredFields ?? []))],
            requireConcepts: ctApplicable.some((r) => r.requireConcepts === true),
            captureRequired: ctApplicable.some((r) => r.captureRequired === true),
          }
        : null;

      const captureToken = createCaptureToken(orgId, args.content);

      return {
        dedupCandidates,
        checklist,
        blockingContentRules,
        captureToken,
        expiresInSeconds: Math.floor(CAPTURE_TOKEN_TTL_MS / 1000),
        ...(ctSource !== undefined ? { source: ctSource } : {}),
      };
    }

    case "get_vocabulary": {
      return getVocabulary(args.kind || undefined, args.query || undefined);
    }

    case "get_related": {
      return getRelated(orgId, {
        term: args.term || undefined,
        slug: args.slug || undefined,
      });
    }

    case "get_semantic_map": {
      return getSemanticMap(args.kind || undefined);
    }

    case "export_page": {
      if (!args.slug) throw new Error("slug is required");
      if (!SLUG_RE.test(args.slug)) throw new Error("invalid slug format");
      const format = args.format ?? "png";
      if (format !== "png" && format !== "pdf") throw new Error("format must be png or pdf");

      const pageData = await readPage(orgId, args.slug);
      if (!pageData) throw new Error(`page not found: ${args.slug}`);

      const chromium = await getChromium();
      const browser = await chromium.launch();
      const url = await previewUrl(args.slug, orgId);
      const pngBuffer = await screenshotPage(url, browser);
      await browser.close();

      if (format === "pdf") {
        const { PDFDocument } = await import("pdf-lib");
        const doc = await PDFDocument.create();
        const img = await doc.embedPng(pngBuffer);
        const { width: imgWidth, height: imgHeight } = img.scale(1);
        const targetWidth = 612;
        const scale = targetWidth / imgWidth;
        const pdfPage = doc.addPage([targetWidth, imgHeight * scale]);
        pdfPage.drawImage(img, { x: 0, y: 0, width: targetWidth, height: imgHeight * scale });
        const pdfBytes = await doc.save();
        return {
          format: "pdf",
          slug: args.slug,
          mimeType: "application/pdf",
          base64: Buffer.from(pdfBytes).toString("base64"),
        };
      }

      return {
        format: "png",
        slug: args.slug,
        mimeType: "image/png",
        base64: pngBuffer.toString("base64"),
      };
    }

    case "export_report": {
      if (!args.slugs) throw new Error("slugs is required");
      if (!args.title) throw new Error("title is required");

      let slugList: string[];
      try {
        slugList = JSON.parse(args.slugs);
      } catch {
        throw new Error("slugs must be a valid JSON array of strings");
      }
      if (!Array.isArray(slugList) || slugList.length === 0) {
        throw new Error("slugs must be a non-empty array");
      }
      for (const s of slugList) {
        if (!SLUG_RE.test(s)) throw new Error(`invalid slug format: ${s}`);
      }

      const chromium = await getChromium();

      const theme = await getOrgTheme(orgId);
      const pageTitles: string[] = [];
      for (const slug of slugList) {
        const pageData = await readPage(orgId, slug);
        if (!pageData) throw new Error(`page not found: ${slug}`);
        pageTitles.push(((pageData.json as { title?: string }).title) ?? slug);
      }

      const reportTitle = args.title;
      const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

      const titlePageHtml = buildTitlePageHtml(reportTitle, args.subtitle, date, slugList.length, pageTitles, theme);
      const appendixHtml = buildAppendixHtml(pageTitles, slugList, theme);

      const browser = await chromium.launch();

      try {
        const { PDFDocument } = await import("pdf-lib");
        const doc = await PDFDocument.create();
        doc.setTitle(reportTitle);
        if (args.subtitle) doc.setSubject(args.subtitle);

        async function addPng(pngBuf: Buffer) {
          const img = await doc.embedPng(pngBuf);
          const { width: w, height: h } = img.scale(1);
          const tw = 612;
          const sc = tw / w;
          const pdfPage = doc.addPage([tw, h * sc]);
          pdfPage.drawImage(img, { x: 0, y: 0, width: tw, height: h * sc });
        }

        await addPng(await renderHtmlToPng(titlePageHtml, browser));
        for (const slug of slugList) {
          const url = await previewUrl(slug, orgId);
          await addPng(await screenshotPage(url, browser));
        }
        await addPng(await renderHtmlToPng(appendixHtml, browser));

        await browser.close();

        const pdfBytes = await doc.save();
        const reportName = reportTitle
          .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

        return {
          format: "pdf",
          title: reportTitle,
          pageCount: slugList.length,
          filename: `${reportName}.pdf`,
          mimeType: "application/pdf",
          base64: Buffer.from(pdfBytes).toString("base64"),
        };
      } catch (err) {
        await browser.close();
        throw err;
      }
    }

    case "list_rules": {
      if (args.slug) {
        if (!SLUG_RE.test(args.slug)) throw new Error("invalid slug format");
        const lrPage = await db.page.findUnique({
          where: { orgId_slug: { orgId, slug: args.slug } },
          select: { folderId: true, rules: true },
        });
        // The tool description promises global rules "if no slug" — an
        // unknown slug isn't the same as no slug, but a caller that got the
        // slug wrong (typo, stale reference, page deleted) shouldn't be
        // stopped cold by a page-not-found error when it can still get a
        // useful answer. Fall back to global rules, and say so, rather than
        // throwing and misleading a caller who read the description as "this
        // always returns rules."
        if (!lrPage) {
          const lrFallbackOrg = await db.organization.findUnique({
            where: { id: orgId },
            select: { rules: true },
          });
          return {
            scope: "global",
            rules: lrFallbackOrg?.rules ?? [],
            note: `page not found: "${args.slug}" — falling back to global rules`,
          };
        }
        const lrRules = await resolveRules(orgId, lrPage.folderId, lrPage.rules);
        const lrRcRules = await resolveRequiredComponentsRules(orgId, lrPage.folderId, lrPage.rules);
        return {
          slug: args.slug,
          inherited: lrRules.inherited,
          page: lrRules.page,
          requiredComponents: {
            inherited: lrRcRules.inherited,
            page: lrRcRules.page,
          },
        };
      }
      const lrOrg = await db.organization.findUnique({
        where: { id: orgId },
        select: { rules: true },
      });
      return {
        scope: "global",
        rules: lrOrg?.rules ?? [],
      };
    }

    case "set_rules": {
      if (!args.scope) throw new Error("scope is required (global, folder, page)");
      let parsedRules: unknown;
      try { parsedRules = JSON.parse(args.rules ?? "[]"); } catch { throw new Error("rules must be valid JSON array"); }
      if (!Array.isArray(parsedRules)) throw new Error("rules must be an array");

      // Approval-kind and required-components-kind entries get shape-validated
      // (malformed ones reject the whole write); other rule kinds keep the
      // existing pass-through behavior of this tool.
      for (const candidate of parsedRules) {
        if (candidate && typeof candidate === "object" && (candidate as Record<string, unknown>).kind === "approval") {
          const validated = validateApprovalRule(candidate);
          if (!validated.ok) throw new Error(`invalid approval rule: ${validated.error}`);
        }
        if (candidate && typeof candidate === "object" && (candidate as Record<string, unknown>).kind === "required-components") {
          const validated = validateRequiredComponentsRule(candidate);
          if (!validated.ok) throw new Error(`invalid required-components rule: ${validated.error}`);
        }
      }

      switch (args.scope) {
        case "global": {
          await db.organization.update({
            where: { id: orgId },
            data: { rules: parsedRules },
          });
          logAudit({ orgId, action: "rules.set", resourceType: "organization", resourceId: orgId, actorType: "apikey", actorId, metadata: { scope: "global", ruleCount: parsedRules.length } });
          return { ok: true, scope: "global", ruleCount: parsedRules.length };
        }
        case "folder": {
          if (!args.scope_id) throw new Error("scope_id (folder ID) is required");
          const srFolder = await db.folder.findFirst({ where: { id: args.scope_id, orgId } });
          if (!srFolder) throw new Error(`folder not found: ${args.scope_id}`);
          await db.folder.update({
            where: { id: args.scope_id },
            data: { rules: parsedRules },
          });
          logAudit({ orgId, action: "rules.set", resourceType: "folder", resourceId: args.scope_id, actorType: "apikey", actorId, metadata: { scope: "folder", folderName: srFolder.name, ruleCount: parsedRules.length } });
          return { ok: true, scope: "folder", folderId: args.scope_id, folderName: srFolder.name, ruleCount: parsedRules.length };
        }
        case "page": {
          if (!args.scope_id) throw new Error("scope_id (page slug) is required");
          if (!SLUG_RE.test(args.scope_id)) throw new Error("invalid slug format for scope_id");
          const srPage = await db.page.findUnique({ where: { orgId_slug: { orgId, slug: args.scope_id } } });
          if (!srPage) throw new Error(`page not found: ${args.scope_id}`);
          await db.page.update({
            where: { id: srPage.id },
            data: { rules: parsedRules },
          });
          logAudit({ orgId, action: "rules.set", resourceType: "page", resourceId: args.scope_id, actorType: "apikey", actorId, metadata: { scope: "page", slug: args.scope_id, ruleCount: parsedRules.length } });
          return { ok: true, scope: "page", slug: args.scope_id, ruleCount: parsedRules.length };
        }
        default:
          throw new Error(`invalid scope: ${args.scope} (must be global, folder, or page)`);
      }
    }

    // Groups: the primitive only — CRUD + membership, owner/admin-gated on
    // the requester's org role (assertGroupManager). Not wired into folder
    // rules, the review queue, or approvals yet.
    case "list_groups": {
      return listGroupsWithMembers(orgId);
    }

    case "create_group": {
      await assertGroupManager(orgId, userId, "create groups");
      if (!args.name) throw new Error("name is required");
      const group = await createGroup(orgId, args.name);
      logAudit({ orgId, action: "group.create", resourceType: "group", resourceId: group.id, actorType: "apikey", actorId, metadata: { name: group.name } });
      return { ok: true, id: group.id, name: group.name, slug: group.slug };
    }

    case "update_group": {
      await assertGroupManager(orgId, userId, "rename groups");
      if (!args.group_id) throw new Error("group_id is required");
      if (!args.name) throw new Error("name is required");
      const group = await renameGroup(orgId, args.group_id, args.name);
      logAudit({ orgId, action: "group.rename", resourceType: "group", resourceId: group.id, actorType: "apikey", actorId, metadata: { name: group.name } });
      return { ok: true, id: group.id, name: group.name, slug: group.slug };
    }

    case "delete_group": {
      await assertGroupManager(orgId, userId, "delete groups");
      if (!args.group_id) throw new Error("group_id is required");
      await deleteGroup(orgId, args.group_id);
      logAudit({ orgId, action: "group.delete", resourceType: "group", resourceId: args.group_id, actorType: "apikey", actorId });
      return { ok: true, id: args.group_id };
    }

    case "add_group_member": {
      await assertGroupManager(orgId, userId, "manage group membership");
      if (!args.group_id) throw new Error("group_id is required");
      if (!args.user_ids) throw new Error("user_ids is required (JSON array or comma-separated list of user IDs)");
      let userIds: string[];
      try {
        const parsed = JSON.parse(args.user_ids);
        userIds = Array.isArray(parsed) ? parsed : [String(parsed)];
      } catch {
        userIds = args.user_ids.split(",").map((s) => s.trim()).filter(Boolean);
      }
      if (userIds.length === 0) throw new Error("user_ids must be a non-empty array or comma-separated list");
      const groupRole = args.role === "owner" ? "owner" : "member";
      const result = await addGroupMembers(orgId, args.group_id, userIds, groupRole);
      logAudit({ orgId, action: "group.member.add", resourceType: "group", resourceId: args.group_id, actorType: "apikey", actorId, metadata: { added: result.added, alreadyMember: result.alreadyMember, invalid: result.invalid } });
      return result;
    }

    case "remove_group_member": {
      await assertGroupManager(orgId, userId, "manage group membership");
      if (!args.group_id) throw new Error("group_id is required");
      if (!args.user_id) throw new Error("user_id is required");
      await removeGroupMember(orgId, args.group_id, args.user_id);
      logAudit({ orgId, action: "group.member.remove", resourceType: "group", resourceId: args.group_id, actorType: "apikey", actorId, metadata: { userId: args.user_id } });
      return { ok: true };
    }

    // mark_trusted/clear_trusted: agents may flip a page's trust pointer, but
    // only if the human behind the calling key is eligible under the same
    // approval rule the dashboard's "Mark trusted" button enforces. Audit
    // logging lives in markTrusted/clearTrusted (pages.ts) — not duplicated
    // here.
    case "mark_trusted": {
      if (!args.slug) throw new Error("slug is required");
      if (!SLUG_RE.test(args.slug)) throw new Error("invalid slug format");
      const actorUserId = userId || "agent";

      const mtPageRow = await db.page.findUnique({
        where: { orgId_slug: { orgId, slug: args.slug } },
        select: { folderId: true, rules: true },
      });
      if (mtPageRow) {
        const { mode } = await resolveEffectiveTrustMode(orgId, mtPageRow.folderId, mtPageRow.rules);
        if (mode === "auto") return { ok: true, noop: true, slug: args.slug };
      }

      const eligible = await resolveTrustEligibility(orgId, userId, args.slug);
      if (!eligible) throw new Error(await trustDenialMessage(orgId, args.slug));

      let versionId = args.version_id;
      if (!versionId) {
        const mtPage = await db.page.findUnique({ where: { orgId_slug: { orgId, slug: args.slug } } });
        if (!mtPage) throw new Error(`page not found: ${args.slug}`);
        const latest = await db.pageVersion.findFirst({
          where: { pageId: mtPage.id },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });
        if (!latest) throw new Error(`no versions found for page: ${args.slug}`);
        versionId = latest.id;
      }

      const result = await markTrusted(orgId, args.slug, versionId, actorUserId);
      if (!result.ok) throw new Error(result.error);
      return { ok: true, slug: args.slug, versionId };
    }

    case "clear_trusted": {
      if (!args.slug) throw new Error("slug is required");
      if (!SLUG_RE.test(args.slug)) throw new Error("invalid slug format");
      const actorUserId = userId || "agent";

      const eligible = await resolveTrustEligibility(orgId, userId, args.slug);
      if (!eligible) throw new Error(await trustDenialMessage(orgId, args.slug));

      const result = await clearTrusted(orgId, args.slug, actorUserId);
      if (!result.ok) throw new Error(result.error);
      return { ok: true, slug: args.slug };
    }

    // generate_digest: gathers new pages (by concept tag), trust flips (read
    // off the audit log's page.trust entries — no new column), pages
    // awaiting review, and hot spots since the last digest run (7 days back
    // the first time). preview:true returns that gathered window data
    // without writing anything — the curata-digest skill uses it to find
    // candidate pages before a human picks the week's synthesis. Otherwise
    // writes/updates a dated page in the Digests folder: "One big thing" and
    // "Noteworthy" render only when big_thing/noteworthy are supplied,
    // "Activity" (stats + hot spots) always renders. The slug is
    // deterministic per ISO week so re-running mid-week updates the same
    // page instead of creating a duplicate.
    case "generate_digest": {
      const now = new Date();
      const data = await gatherDigestData(orgId, userId, now);
      const gdSlug = digestSlug(now);
      const gdTitle = digestTitle(now);

      if (truthyArg(args.preview)) {
        return {
          preview: true,
          slug: gdSlug,
          windowStart: data.windowStart.toISOString(),
          windowEnd: data.windowEnd.toISOString(),
          newPageCount: data.newPageCount,
          taggedNewPageCount: data.taggedNewPageCount,
          newPagesByConcept: data.newPagesByConcept,
          uncategorizedNewPages: data.uncategorizedNewPages,
          trustFlips: data.trustFlips,
          awaitingReview: data.awaitingReview,
          hotSpots: data.hotSpots,
        };
      }

      const gdBigThing = args.big_thing ? await parseDigestBigThing(orgId, userId, args.big_thing) : undefined;
      const gdNoteworthy = args.noteworthy ? await parseDigestNoteworthy(orgId, userId, args.noteworthy) : undefined;

      const gdContent = buildDigestPageYaml(data, orgSlug, gdTitle, { bigThing: gdBigThing, noteworthy: gdNoteworthy });

      const gdUnsupported = checkUnsupportedComponents(gdContent);
      if (gdUnsupported.length > 0) throw new Error(gdUnsupported.map((e) => e.message).join("; "));
      const gdValidation = await validateContent(orgSlug, gdSlug, gdContent);
      if (gdValidation.length > 0) {
        throw new Error(`invalid digest content: ${gdValidation.map((e) => e.message).join("; ")}`);
      }

      const gdExisting = await db.page.findUnique({ where: { orgId_slug: { orgId, slug: gdSlug } } });
      const gdFolderId = await ensureDigestsFolder(orgId, actorId);

      const gdResult = await writePage(orgId, orgSlug, gdSlug, gdContent, "agent", undefined, undefined, "org");
      if (!gdResult.ok) throw new Error(gdResult.error);

      if (!gdExisting || gdExisting.folderId !== gdFolderId) {
        await db.page.update({ where: { orgId_slug: { orgId, slug: gdSlug } }, data: { folderId: gdFolderId } });
      }

      const gdPage = await db.page.findUnique({ where: { orgId_slug: { orgId, slug: gdSlug } }, select: { id: true } });
      if (gdPage) {
        await upsertConcepts(gdPage.id, [{ term: "digest" }], actorId);
      }

      const gdSummary = {
        newPages: data.newPagesByConcept.reduce((sum, g) => sum + g.pages.length, 0) + data.uncategorizedNewPages.length,
        trustFlips: data.trustFlips.length,
        awaitingReview: data.awaitingReview.length,
        hotSpots: data.hotSpots.length,
      };

      // Weekly version-retention sweep, piggybacked on the digest run since
      // that already fires once a week per org. Never allowed to fail the
      // digest itself — a sweep error just gets logged.
      try {
        await sweepVersions(orgId);
      } catch (err) {
        console.error(`[version-retention] sweepVersions failed for org ${orgId}:`, err);
      }

      logAudit({
        orgId,
        action: "digest.generate",
        resourceType: "page",
        resourceId: gdSlug,
        actorType: "apikey",
        actorId,
        metadata: { windowStart: data.windowStart.toISOString(), windowEnd: data.windowEnd.toISOString(), ...gdSummary },
      });

      return {
        ok: true,
        slug: gdSlug,
        folderId: gdFolderId,
        created: !gdExisting,
        windowStart: data.windowStart.toISOString(),
        windowEnd: data.windowEnd.toISOString(),
        summary: gdSummary,
      };
    }

    default:
      throw new Error(`unknown tool: ${tool}`);
  }
}
