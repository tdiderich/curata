export function slugify(title: string): string {
  if (!title || !title.trim()) return "untitled";
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "untitled";
}

export interface ApiResponse {
  result?: unknown;
  error?: string;
}

export async function callApi(
  baseUrl: string,
  apiKey: string,
  tool: string,
  args: Record<string, string>
): Promise<ApiResponse> {
  const url = `${baseUrl}/api/kazam`;
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ tool, args }),
      signal: AbortSignal.timeout(30_000),
    });

    if (res.status === 401) {
      return { error: "Unauthorized — check your CURATA_API_KEY" };
    }
    if (res.status === 403) {
      return { error: "Forbidden — your API key doesn't have the required scope for this operation" };
    }
    if (res.status === 429) {
      return { error: "Rate limit exceeded — wait a moment and try again" };
    }

    const json = await res.json() as Record<string, unknown>;

    if (!res.ok) {
      return { error: (json.error as string) || `HTTP ${res.status}` };
    }

    return { result: json.result };
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      return { error: "Request timed out — check your CURATA_URL and network connection" };
    }
    if (err instanceof Error && (err.message.includes("ECONNREFUSED") || err.message.includes("fetch failed"))) {
      return { error: `Cannot reach curata at ${baseUrl} — check your CURATA_URL` };
    }
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

interface SearchResult {
  slug: string;
  title: string;
  matches: string[];
}

export function formatSearchResults(results: SearchResult[], query: string): string {
  if (!results || results.length === 0) {
    return `No pages found matching "${query}"`;
  }

  const lines = [`Found ${results.length} page${results.length !== 1 ? "s" : ""} matching "${query}":\n`];
  for (const r of results.slice(0, 5)) {
    lines.push(`## ${r.title}`);
    lines.push(`slug: ${r.slug}`);
    if (r.matches.length > 0) {
      lines.push("Matching lines:");
      for (const m of r.matches) {
        lines.push(`  > ${m}`);
      }
    }
    lines.push("");
  }

  if (results.length > 5) {
    lines.push(`...and ${results.length - 5} more results`);
  }

  return lines.join("\n");
}

export function formatPageList(pages: Array<Record<string, unknown>>): string {
  if (!pages || pages.length === 0) {
    return "No pages in the knowledge base yet.";
  }

  const lines = [`${pages.length} page${pages.length !== 1 ? "s" : ""} in your knowledge base:\n`];
  for (const p of pages) {
    const views = (p.viewCount as number) || 0;
    const annotations = (p.annotationCount as number) || 0;
    const updated = p.updatedAt ? new Date(p.updatedAt as string).toLocaleDateString() : "unknown";
    const folder = p.folderName ? ` [${p.folderName}]` : "";
    lines.push(`- **${p.title}** (slug: ${p.slug})${folder}`);
    lines.push(`  Updated: ${updated} | Views: ${views} | Annotations: ${annotations}`);
  }

  return lines.join("\n");
}

export function formatPageDetail(page: Record<string, unknown>): string {
  const lines: string[] = [];

  lines.push(`# ${(page.slug as string) || "Page"}`);
  if (page.contentHash) {
    lines.push(`Content hash: ${page.contentHash}`);
  }
  lines.push("");

  if (page.yaml) {
    lines.push("## Content (YAML)");
    lines.push("```yaml");
    lines.push(page.yaml as string);
    lines.push("```");
    lines.push("");
  }

  const sections = page.sections as string[] | undefined;
  if (sections && sections.length > 0) {
    lines.push("## Sections");
    for (const s of sections) {
      lines.push(`- ${s}`);
    }
    lines.push("");
  }

  const annotations = page.annotations as Array<Record<string, unknown>> | undefined;
  if (annotations && annotations.length > 0) {
    lines.push("## Annotations");
    for (const a of annotations) {
      const status = a.status || "pending";
      const kind = a.kind || "note";
      lines.push(`- [${status}] (${kind}) id=${a.id} by ${a.author}: ${a.text}`);
      if (a.section) lines.push(`  Section: ${a.section}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
