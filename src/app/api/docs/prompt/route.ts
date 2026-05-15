const PROMPT = `# Curata — Knowledge Store for AI Agent Outputs

Curata is a read-write knowledge base where AI agents publish structured pages and humans curate them. Pages are written in kazam YAML format.

## Quick Setup

1. Sign up at curata.ai (free for solo use)
2. Go to Settings → API Keys → Create key (starts with ck_)
3. Add this to your MCP config:

For Claude Code (.mcp.json):
{
  "mcpServers": {
    "curata": {
      "type": "url",
      "url": "https://curata.ai/api/mcp/stream",
      "headers": { "Authorization": "Bearer YOUR_API_KEY" }
    }
  }
}

For Cursor (.cursor/mcp.json): same JSON as above.

For self-hosted (no auth): omit headers, use http://localhost:3000/api/mcp/stream

## MCP Tools Available
- search_pages(query) — search knowledge base
- read_page(slug) — read full page content + annotations
- list_pages() — list all pages
- write_page(title, content, slug?) — create or update page (upsert)
- create_page(title, content, slug?) — create new page (fails if exists)
- annotate_page(slug, text, section?, kind?) — add annotation

## Writing Pages
Pages use kazam YAML format. Key fields: title, subtitle, shell (standard|document|deck), components[].

For the full component reference (40+ component types with examples), fetch:
https://curata.ai/api/docs/components

For the full agents reference (detailed tool docs), fetch:
https://curata.ai/api/docs/agents

## What to do now
Explain how curata works based on what you know about this project. Then help me set it up — generate the MCP config with the right URL for my editor.
`;

export async function GET() {
  return new Response(PROMPT, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
