#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { slugify, callApi, formatSearchResults, formatPageList, formatPageDetail } from "./lib.js";
const CURATA_API_KEY = process.env.CURATA_API_KEY || "";
const CURATA_URL = (process.env.CURATA_URL || "https://curata.ai").replace(/\/$/, "");
const NO_AUTH = !CURATA_API_KEY;
if (!CURATA_API_KEY && !process.env.CURATA_URL) {
    process.stderr.write("Error: CURATA_API_KEY is required (or set CURATA_URL for a no-auth instance).\n" +
        "Get your API key from your curata dashboard: Settings → API Keys\n");
    process.exit(1);
}
const server = new McpServer({
    name: "curata",
    version: "0.1.0",
});
server.tool("search_pages", "Search your team's knowledge base. Returns matching pages with titles, snippets, and relevance context.", { query: z.string().describe("Search query — keywords, phrases, or topics to find") }, async ({ query }) => {
    const result = await callApi(CURATA_URL, CURATA_API_KEY, "search", { query });
    if (result.error) {
        return { content: [{ type: "text", text: `Error: ${result.error}` }], isError: true };
    }
    const text = formatSearchResults(result.result, query);
    return { content: [{ type: "text", text }] };
});
server.tool("read_page", "Read a specific page by its slug. Returns the full YAML content, sections, and any annotations.", { slug: z.string().describe("Page slug (e.g., 'q2-revenue-analysis')") }, async ({ slug }) => {
    const result = await callApi(CURATA_URL, CURATA_API_KEY, "read_page", { slug });
    if (result.error) {
        return { content: [{ type: "text", text: `Error: ${result.error}` }], isError: true };
    }
    const text = formatPageDetail(result.result);
    return { content: [{ type: "text", text }] };
});
server.tool("list_pages", "List all pages in your team's knowledge base. Returns titles, slugs, last updated dates, and view counts.", {}, async () => {
    const result = await callApi(CURATA_URL, CURATA_API_KEY, "list_pages", {});
    if (result.error) {
        return { content: [{ type: "text", text: `Error: ${result.error}` }], isError: true };
    }
    const text = formatPageList(result.result);
    return { content: [{ type: "text", text }] };
});
server.tool("write_page", "Create or update a page in your team's knowledge base. If a page with the derived slug already exists, it will be updated. Content should be valid kazam YAML.", {
    title: z.string().describe("Page title (e.g., 'Q2 Revenue Analysis')"),
    content: z.string().describe("Full page content in kazam YAML format"),
    slug: z.string().optional().describe("Optional explicit slug. If omitted, derived from title."),
}, async ({ title, content, slug: explicitSlug }) => {
    const slug = explicitSlug || slugify(title);
    const result = await callApi(CURATA_URL, CURATA_API_KEY, "write_page", { slug, content });
    if (result.error) {
        if (result.error.includes("page not found") || result.error.includes("not found")) {
            const createResult = await callApi(CURATA_URL, CURATA_API_KEY, "create_page", { slug, content });
            if (createResult.error) {
                return { content: [{ type: "text", text: `Error creating page: ${createResult.error}` }], isError: true };
            }
            return { content: [{ type: "text", text: `Created page "${title}" (slug: ${slug})` }] };
        }
        return { content: [{ type: "text", text: `Error: ${result.error}` }], isError: true };
    }
    return { content: [{ type: "text", text: `Updated page "${title}" (slug: ${slug})` }] };
});
server.tool("create_page", "Create a new page in your team's knowledge base. Fails if a page with the same slug already exists. Content should be valid kazam YAML.", {
    title: z.string().describe("Page title"),
    content: z.string().describe("Full page content in kazam YAML format"),
    slug: z.string().optional().describe("Optional explicit slug. If omitted, derived from title."),
}, async ({ title, content, slug: explicitSlug }) => {
    const slug = explicitSlug || slugify(title);
    const result = await callApi(CURATA_URL, CURATA_API_KEY, "create_page", { slug, content });
    if (result.error) {
        return { content: [{ type: "text", text: `Error: ${result.error}` }], isError: true };
    }
    return { content: [{ type: "text", text: `Created page "${title}" (slug: ${slug})` }] };
});
server.tool("annotate_page", "Add an annotation (comment, suggestion, or edit) to a page. Annotations are visible to the team and can be reviewed.", {
    slug: z.string().describe("Page slug to annotate"),
    text: z.string().describe("Annotation text — observation, suggestion, or edit note"),
    section: z.string().optional().describe("Target section heading (e.g., 'Key Metrics')"),
    kind: z.enum(["note", "edit"]).optional().describe("'note' for observations, 'edit' for suggested changes"),
    replacement: z.string().optional().describe("For 'edit' kind: the replacement text"),
}, async ({ slug, text, section, kind, replacement }) => {
    const args = { slug, text, author: "agent" };
    if (section)
        args.section = section;
    if (kind)
        args.kind = kind;
    if (replacement)
        args.replacement = replacement;
    const result = await callApi(CURATA_URL, CURATA_API_KEY, "annotate_page", args);
    if (result.error) {
        return { content: [{ type: "text", text: `Error: ${result.error}` }], isError: true };
    }
    return { content: [{ type: "text", text: `Annotation added to "${slug}"` }] };
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write("curata MCP server running\n");
}
main().catch((err) => {
    process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
});
//# sourceMappingURL=index.js.map