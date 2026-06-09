#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { slugify, callApi, formatSearchResults, formatPageList, formatPageDetail } from "./lib.js";

const CURATA_API_KEY = process.env.CURATA_API_KEY || "";
const CURATA_URL = (process.env.CURATA_URL || "http://localhost:3000").replace(/\/$/, "");
const NO_AUTH = !CURATA_API_KEY;

if (!CURATA_API_KEY && !process.env.CURATA_URL) {
  process.stderr.write(
    "Error: CURATA_API_KEY is required (or set CURATA_URL for a no-auth instance).\n" +
    "Get your API key from your curata dashboard: Settings → API Keys\n"
  );
  process.exit(1);
}

const server = new McpServer({
  name: "curata",
  version: "0.1.0",
});

server.tool(
  "search_pages",
  "Search your team's knowledge base. Returns matching pages with titles, snippets, and relevance context.",
  { query: z.string().describe("Search query — keywords, phrases, or topics to find") },
  async ({ query }) => {
    const result = await callApi(CURATA_URL, CURATA_API_KEY, "search", { query });
    if (result.error) {
      return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true };
    }
    const text = formatSearchResults(result.result as Array<{ slug: string; title: string; matches: string[] }>, query);
    return { content: [{ type: "text" as const, text }] };
  }
);

server.tool(
  "read_page",
  "Read a specific page by its slug. Returns the full YAML content, sections, and any annotations.",
  { slug: z.string().describe("Page slug (e.g., 'q2-revenue-analysis')") },
  async ({ slug }) => {
    const result = await callApi(CURATA_URL, CURATA_API_KEY, "read_page", { slug });
    if (result.error) {
      return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true };
    }
    const text = formatPageDetail(result.result as Record<string, unknown>);
    return { content: [{ type: "text" as const, text }] };
  }
);

server.tool(
  "list_pages",
  "List all pages in your team's knowledge base. Returns titles, slugs, last updated dates, and view counts.",
  {},
  async () => {
    const result = await callApi(CURATA_URL, CURATA_API_KEY, "list_pages", {});
    if (result.error) {
      return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true };
    }
    const text = formatPageList(result.result as Array<Record<string, unknown>>);
    return { content: [{ type: "text" as const, text }] };
  }
);

server.tool(
  "write_page",
  "Create or update a page in your team's knowledge base. If a page with the derived slug already exists, it will be updated. Content should be valid kazam YAML. Call get_component_reference first to learn the YAML syntax for charts, stat grids, and other components. Optionally tag concepts and cross-page links — call get_vocabulary first to reuse existing terms.",
  {
    title: z.string().describe("Page title (e.g., 'Q2 Revenue Analysis')"),
    content: z.string().describe("Full page content in kazam YAML format"),
    slug: z.string().optional().describe("Optional explicit slug. If omitted, derived from title."),
    folder_id: z.string().optional().describe("Optional folder ID to place the page in. Use list_folders to find folder IDs."),
    concepts: z.string().optional().describe("JSON array of concepts to tag on this page. Each: {term, kind?, section?}. Call get_vocabulary first to reuse existing terms."),
    links: z.string().optional().describe("JSON array of cross-page links. Each: {target (slug), rel (informs|references|supersedes|conflicts), description?}"),
  },
  async ({ title, content, slug: explicitSlug, folder_id, concepts, links }) => {
    const slug = explicitSlug || slugify(title);
    const args: Record<string, string> = { slug, content };
    if (folder_id) args.folder_id = folder_id;
    if (concepts) args.concepts = concepts;
    if (links) args.links = links;
    const result = await callApi(CURATA_URL, CURATA_API_KEY, "write_page", args);
    if (result.error) {
      if (result.error.includes("page not found") || result.error.includes("not found")) {
        const createResult = await callApi(CURATA_URL, CURATA_API_KEY, "create_page", args);
        if (createResult.error) {
          return { content: [{ type: "text" as const, text: `Error creating page: ${createResult.error}` }], isError: true };
        }
        return { content: [{ type: "text" as const, text: `Created page "${title}" (slug: ${slug})` }] };
      }
      return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true };
    }
    return { content: [{ type: "text" as const, text: `Updated page "${title}" (slug: ${slug})` }] };
  }
);

server.tool(
  "create_page",
  "Create a new page in your team's knowledge base. Fails if a page with the same slug already exists. Content should be valid kazam YAML. Call get_component_reference first to learn the YAML syntax.",
  {
    title: z.string().describe("Page title"),
    content: z.string().describe("Full page content in kazam YAML format"),
    slug: z.string().optional().describe("Optional explicit slug. If omitted, derived from title."),
    folder_id: z.string().optional().describe("Optional folder ID to place the page in. Use list_folders to find folder IDs."),
  },
  async ({ title, content, slug: explicitSlug, folder_id }) => {
    const slug = explicitSlug || slugify(title);
    const args: Record<string, string> = { slug, content };
    if (folder_id) args.folder_id = folder_id;
    const result = await callApi(CURATA_URL, CURATA_API_KEY, "create_page", args);
    if (result.error) {
      return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true };
    }
    return { content: [{ type: "text" as const, text: `Created page "${title}" (slug: ${slug})` }] };
  }
);

server.tool(
  "list_folders",
  "List all folders in the knowledge base. Returns folder IDs, names, parent relationships, and page counts. Use folder IDs with create_page, write_page, or move_page.",
  {},
  async () => {
    const result = await callApi(CURATA_URL, CURATA_API_KEY, "list_folders", {});
    if (result.error) {
      return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true };
    }
    const folders = result.result as Array<{ id: string; name: string; parentId: string | null; pageCount: number }>;
    if (!folders || folders.length === 0) {
      return { content: [{ type: "text" as const, text: "No folders in the knowledge base." }] };
    }
    const lines = [`${folders.length} folder${folders.length !== 1 ? "s" : ""}:\n`];
    for (const f of folders) {
      const parent = f.parentId ? ` (parent: ${f.parentId})` : "";
      lines.push(`- **${f.name}** (id: ${f.id})${parent} — ${f.pageCount} page${f.pageCount !== 1 ? "s" : ""}`);
    }
    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

server.tool(
  "get_folder_structure",
  "Get the full folder tree with pages nested under each folder. Shows the complete knowledge base structure at a glance.",
  {},
  async () => {
    const [folderResult, pageResult] = await Promise.all([
      callApi(CURATA_URL, CURATA_API_KEY, "list_folders", {}),
      callApi(CURATA_URL, CURATA_API_KEY, "list_pages", {}),
    ]);
    if (folderResult.error) {
      return { content: [{ type: "text" as const, text: `Error: ${folderResult.error}` }], isError: true };
    }
    if (pageResult.error) {
      return { content: [{ type: "text" as const, text: `Error: ${pageResult.error}` }], isError: true };
    }
    const folders = (folderResult.result || []) as Array<{ id: string; name: string; parentId: string | null; pageCount: number }>;
    const pages = (pageResult.result || []) as Array<{ title: string; slug: string; folderId: string | null }>;
    const folderMap = new Map(folders.map((f) => [f.id, f]));
    const childFolders = new Map<string | null, typeof folders>();
    for (const f of folders) {
      const key = f.parentId;
      if (!childFolders.has(key)) childFolders.set(key, []);
      childFolders.get(key)!.push(f);
    }
    const pagesByFolder = new Map<string | null, typeof pages>();
    for (const p of pages) {
      const key = p.folderId;
      if (!pagesByFolder.has(key)) pagesByFolder.set(key, []);
      pagesByFolder.get(key)!.push(p);
    }
    const lines: string[] = [];
    function renderFolder(folderId: string, indent: string) {
      const f = folderMap.get(folderId)!;
      lines.push(`${indent}📁 **${f.name}** (id: ${f.id})`);
      const folderPages = pagesByFolder.get(folderId) || [];
      for (const p of folderPages) {
        lines.push(`${indent}  📄 ${p.title} (${p.slug})`);
      }
      const children = childFolders.get(folderId) || [];
      for (const child of children) {
        renderFolder(child.id, indent + "  ");
      }
    }
    const rootFolders = childFolders.get(null) || [];
    for (const f of rootFolders) {
      renderFolder(f.id, "");
    }
    const unfiled = pagesByFolder.get(null) || [];
    if (unfiled.length > 0) {
      lines.push("");
      lines.push("📄 **Unfiled pages:**");
      for (const p of unfiled) {
        lines.push(`  📄 ${p.title} (${p.slug})`);
      }
    }
    if (lines.length === 0) {
      return { content: [{ type: "text" as const, text: "Knowledge base is empty." }] };
    }
    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

server.tool(
  "move_page",
  "Move a page to a different folder, or remove it from its current folder.",
  {
    slug: z.string().describe("Page slug to move"),
    folder_id: z.string().optional().describe("Target folder ID. Omit or pass empty string to remove from folder."),
  },
  async ({ slug, folder_id }) => {
    const args: Record<string, string> = { slug };
    if (folder_id) args.folder_id = folder_id;
    const result = await callApi(CURATA_URL, CURATA_API_KEY, "move_page", args);
    if (result.error) {
      return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true };
    }
    const dest = folder_id ? `folder ${folder_id}` : "no folder";
    return { content: [{ type: "text" as const, text: `Moved "${slug}" to ${dest}` }] };
  }
);

server.tool(
  "get_component_reference",
  "Get the full YAML authoring guide for kazam components — charts, stat grids, tables, callouts, and all other component types with syntax and examples. Call this before writing page content.",
  {},
  async () => {
    const result = await callApi(CURATA_URL, CURATA_API_KEY, "get_component_reference", {});
    if (result.error) {
      return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true };
    }
    const ref = result.result as { content: string };
    return { content: [{ type: "text" as const, text: ref.content }] };
  }
);

server.tool(
  "annotate_page",
  "Add an annotation (comment, suggestion, or edit) to a page. Annotations are visible to the team and can be reviewed.",
  {
    slug: z.string().describe("Page slug to annotate"),
    text: z.string().describe("Annotation text — observation, suggestion, or edit note"),
    section: z.string().optional().describe("Target section heading (e.g., 'Key Metrics')"),
    kind: z.enum(["note", "edit"]).optional().describe("'note' for observations, 'edit' for suggested changes"),
    replacement: z.string().optional().describe("For 'edit' kind: the replacement text"),
  },
  async ({ slug, text, section, kind, replacement }) => {
    const args: Record<string, string> = { slug, text, author: "agent" };
    if (section) args.section = section;
    if (kind) args.kind = kind;
    if (replacement) args.replacement = replacement;
    const result = await callApi(CURATA_URL, CURATA_API_KEY, "annotate_page", args);
    if (result.error) {
      return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true };
    }
    return { content: [{ type: "text" as const, text: `Annotation added to "${slug}"` }] };
  }
);

server.tool(
  "update_annotation",
  "Update the status of a single annotation on a page. Use after reviewing an annotation to approve, ignore, or mark it as incorporated.",
  {
    slug: z.string().describe("Page slug containing the annotation"),
    id: z.string().describe("Annotation ID (shown in read_page output)"),
    status: z.enum(["approved", "ignored", "incorporated"]).describe("New status: 'approved' to accept, 'ignored' to dismiss, 'incorporated' when changes have been applied"),
  },
  async ({ slug, id, status }) => {
    const result = await callApi(CURATA_URL, CURATA_API_KEY, "update_annotation", { slug, id, status });
    if (result.error) {
      return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true };
    }
    return { content: [{ type: "text" as const, text: `Annotation ${id} on "${slug}" marked as ${status}` }] };
  }
);

server.tool(
  "resolve_annotations",
  "Mark all pending annotations on a page as incorporated. Use after processing all feedback and updating the page content.",
  {
    slug: z.string().describe("Page slug to clear annotations for"),
    status: z.enum(["approved", "ignored", "incorporated"]).optional().describe("Status to set (default: 'incorporated')"),
  },
  async ({ slug, status: targetStatus }) => {
    const resolveAs = targetStatus || "incorporated";
    const listResult = await callApi(CURATA_URL, CURATA_API_KEY, "list_annotations", { slug });
    if (listResult.error) {
      return { content: [{ type: "text" as const, text: `Error listing annotations: ${listResult.error}` }], isError: true };
    }
    const annotations = listResult.result as Array<{ id: string; status: string }>;
    const pending = annotations.filter((a) => a.status === "pending" || a.status === "approved");
    if (pending.length === 0) {
      return { content: [{ type: "text" as const, text: `No pending annotations on "${slug}"` }] };
    }
    let resolved = 0;
    let failed = 0;
    for (const ann of pending) {
      const r = await callApi(CURATA_URL, CURATA_API_KEY, "update_annotation", { slug, id: ann.id, status: resolveAs });
      if (r.error) failed++;
      else resolved++;
    }
    const msg = `Resolved ${resolved} annotation${resolved !== 1 ? "s" : ""} on "${slug}" as ${resolveAs}` +
      (failed > 0 ? ` (${failed} failed)` : "");
    return { content: [{ type: "text" as const, text: msg }] };
  }
);

server.tool(
  "flag_page",
  "Flag a page for cleanup. Agent proposes, human disposes: this files a flag with evidence into the human Cleanup queue — it never archives or deletes anything itself. Call list_flags first to avoid re-filing proposals a human already dismissed.",
  {
    slug: z.string().describe("Page slug to flag"),
    action: z.enum(["archive", "delete", "merge", "supersede"]).describe("Proposed disposition"),
    reason: z.enum(["shipped-not-closed", "superseded", "stale", "duplicate", "one-off-expired"]).describe("Why this page is a cleanup candidate"),
    evidence: z.string().describe("What you checked — repo paths, commit dates, task-tree state, the replacing page"),
    superseded_by: z.string().optional().describe("Slug of the replacing page (required when action is supersede)"),
    confidence: z.enum(["high", "medium", "low"]).optional().describe("How sure you are (default medium)"),
  },
  async ({ slug, action, reason, evidence, superseded_by, confidence }) => {
    const args: Record<string, string> = { slug, action, reason, evidence };
    if (superseded_by) args.superseded_by = superseded_by;
    if (confidence) args.confidence = confidence;
    const result = await callApi(CURATA_URL, CURATA_API_KEY, "flag_page", args);
    if (result.error) {
      return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true };
    }
    const data = result.result as { ok: boolean; skipped?: boolean; message?: string; flagId?: string; note?: string };
    if (data.skipped) {
      return { content: [{ type: "text" as const, text: data.message ?? "Flag skipped." }] };
    }
    return { content: [{ type: "text" as const, text: `Flagged "${slug}" for ${action} (${reason}).${data.note ? ` Note: ${data.note}` : ""}` }] };
  }
);

server.tool(
  "list_flags",
  "List cleanup flags: pending proposals plus human dispositions (kept/snoozed/resolved). Check this before a cleanup sweep so you don't re-file flags a human already dismissed.",
  {
    status: z.enum(["pending", "kept", "snoozed", "resolved", "all"]).optional().describe("Filter (default: all)"),
  },
  async ({ status }) => {
    const args: Record<string, string> = {};
    if (status) args.status = status;
    const result = await callApi(CURATA_URL, CURATA_API_KEY, "list_flags", args);
    if (result.error) {
      return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true };
    }
    const flags = result.result as Array<{ id: string; slug: string; title: string; action: string; reason: string; confidence: string; status: string; evidence: string; flaggedBy: string; resolvedBy?: string }>;
    if (flags.length === 0) {
      return { content: [{ type: "text" as const, text: "No flags on record." }] };
    }
    const lines = [`**${flags.length} flag${flags.length !== 1 ? "s" : ""}**\n`];
    for (const f of flags) {
      lines.push(`- [${f.status}] ${f.title} (${f.slug}) — ${f.action}/${f.reason} (${f.confidence}) by ${f.flaggedBy}${f.resolvedBy ? `, resolved by ${f.resolvedBy}` : ""}: ${f.evidence}`);
    }
    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

server.tool(
  "list_open_annotations",
  "Fetch the org-wide queue of open human feedback: every pending/approved annotation across all pages, grouped by page. This is the entry point for processing annotations — for each page, read_page, apply the feedback, write the page back, then update_annotation to incorporated (or ignored, with a reason). See the 'Workflow — Process Annotations' page for the full procedure.",
  {
    status: z.enum(["pending", "approved"]).optional().describe("Filter to one status (default: both pending and approved)"),
  },
  async ({ status }) => {
    const args: Record<string, string> = {};
    if (status) args.status = status;
    const result = await callApi(CURATA_URL, CURATA_API_KEY, "list_open_annotations", args);
    if (result.error) {
      return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true };
    }
    const data = result.result as {
      totalAnnotations: number;
      pageCount: number;
      pages: Array<{ slug: string; title: string; annotations: Array<{ id: string; kind: string; status: string; author: string; text: string; target?: string; replacement?: string }> }>;
    };
    if (!data.totalAnnotations) {
      return { content: [{ type: "text" as const, text: "Annotation queue is empty — nothing to process." }] };
    }
    const lines = [`**${data.totalAnnotations} open annotation${data.totalAnnotations !== 1 ? "s" : ""} across ${data.pageCount} page${data.pageCount !== 1 ? "s" : ""}**\n`];
    for (const p of data.pages) {
      lines.push(`## ${p.title} (${p.slug})`);
      for (const a of p.annotations) {
        const edit = a.kind === "edit" && a.target ? ` | edit: "${a.target}" → "${a.replacement ?? ""}"` : "";
        lines.push(`- [${a.id}] (${a.status}, by ${a.author}) ${a.text}${edit}`);
      }
      lines.push("");
    }
    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

server.tool(
  "get_vocabulary",
  "Get the shared concept vocabulary — canonical terms that agents have tagged across all pages. Call this before tagging concepts on a page to reuse existing terms and avoid synonyms. Returns terms sorted by usage count (most-used first).",
  {
    kind: z.string().optional().describe("Filter by concept kind (e.g., 'vendor', 'finding', 'framework')"),
    query: z.string().optional().describe("Prefix search on term name (e.g., 'crowd' matches 'CrowdStrike')"),
  },
  async ({ kind, query }) => {
    const args: Record<string, string> = {};
    if (kind) args.kind = kind;
    if (query) args.query = query;
    const result = await callApi(CURATA_URL, CURATA_API_KEY, "get_vocabulary", args);
    if (result.error) {
      return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true };
    }
    const data = result.result as { concepts: Array<{ term: string; kind: string; usageCount: number }>; kinds: string[] };
    if (!data.concepts || data.concepts.length === 0) {
      return { content: [{ type: "text" as const, text: "No concepts in vocabulary yet." }] };
    }
    const lines = [`**Vocabulary** (${data.concepts.length} terms, kinds: ${data.kinds.join(", ") || "none"})\n`];
    for (const c of data.concepts) {
      lines.push(`- **${c.term}** [${c.kind || "untyped"}] — used ${c.usageCount}x`);
    }
    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

server.tool(
  "get_related",
  "Find pages and concepts related to a given term or page. Use to discover cross-customer patterns and connections in the knowledge graph.",
  {
    term: z.string().optional().describe("Concept term to look up (e.g., 'CrowdStrike')"),
    slug: z.string().optional().describe("Page slug to find related content for"),
  },
  async ({ term, slug }) => {
    const args: Record<string, string> = {};
    if (term) args.term = term;
    if (slug) args.slug = slug;
    if (!term && !slug) {
      return { content: [{ type: "text" as const, text: "Error: provide either 'term' or 'slug'" }], isError: true };
    }
    const result = await callApi(CURATA_URL, CURATA_API_KEY, "get_related", args);
    if (result.error) {
      return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true };
    }
    const data = result.result as {
      concepts: Array<{ term: string; kind: string; usageCount: number }>;
      pages: Array<{ slug: string; title: string; sharedConcepts: string[] }>;
      links: Array<{ from: string; to: string; rel: string }>;
    };
    const lines: string[] = [];
    if (data.concepts.length > 0) {
      lines.push("**Concepts:**");
      for (const c of data.concepts) lines.push(`- ${c.term} [${c.kind}] (${c.usageCount}x)`);
    }
    if (data.pages.length > 0) {
      lines.push("\n**Related pages:**");
      for (const p of data.pages) lines.push(`- ${p.title} (${p.slug}) — shared: ${p.sharedConcepts.join(", ")}`);
    }
    if (data.links.length > 0) {
      lines.push("\n**Direct links:**");
      for (const l of data.links) lines.push(`- ${l.from} → ${l.to} [${l.rel}]`);
    }
    if (lines.length === 0) lines.push("No related content found.");
    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

server.tool(
  "get_semantic_map",
  "Get the full knowledge graph in compact form — all concepts with their page lists, all cross-page links, and stats (including count of pages without concepts). Use to understand the full knowledge structure, find gaps for semantic refresh, or discover cross-customer patterns.",
  {
    kind: z.string().optional().describe("Filter concepts by kind (e.g., 'vendor')"),
  },
  async ({ kind }) => {
    const args: Record<string, string> = {};
    if (kind) args.kind = kind;
    const result = await callApi(CURATA_URL, CURATA_API_KEY, "get_semantic_map", args);
    if (result.error) {
      return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(result.result, null, 2) }] };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("curata MCP server running\n");
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
