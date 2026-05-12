export function slugify(title) {
    if (!title || !title.trim())
        return "untitled";
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
export async function callApi(baseUrl, apiKey, tool, args) {
    const url = `${baseUrl}/api/kazam`;
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
            },
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
        const json = await res.json();
        if (!res.ok) {
            return { error: json.error || `HTTP ${res.status}` };
        }
        return { result: json.result };
    }
    catch (err) {
        if (err instanceof Error && err.name === "TimeoutError") {
            return { error: "Request timed out — check your CURATA_URL and network connection" };
        }
        if (err instanceof Error && (err.message.includes("ECONNREFUSED") || err.message.includes("fetch failed"))) {
            return { error: `Cannot reach curata at ${baseUrl} — check your CURATA_URL` };
        }
        return { error: err instanceof Error ? err.message : String(err) };
    }
}
export function formatSearchResults(results, query) {
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
export function formatPageList(pages) {
    if (!pages || pages.length === 0) {
        return "No pages in the knowledge base yet.";
    }
    const lines = [`${pages.length} page${pages.length !== 1 ? "s" : ""} in your knowledge base:\n`];
    for (const p of pages) {
        const views = p.viewCount || 0;
        const annotations = p.annotationCount || 0;
        const updated = p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : "unknown";
        lines.push(`- **${p.title}** (slug: ${p.slug})`);
        lines.push(`  Updated: ${updated} | Views: ${views} | Annotations: ${annotations}`);
    }
    return lines.join("\n");
}
export function formatPageDetail(page) {
    const lines = [];
    lines.push(`# ${page.slug || "Page"}`);
    if (page.contentHash) {
        lines.push(`Content hash: ${page.contentHash}`);
    }
    lines.push("");
    if (page.yaml) {
        lines.push("## Content (YAML)");
        lines.push("```yaml");
        lines.push(page.yaml);
        lines.push("```");
        lines.push("");
    }
    const sections = page.sections;
    if (sections && sections.length > 0) {
        lines.push("## Sections");
        for (const s of sections) {
            lines.push(`- ${s}`);
        }
        lines.push("");
    }
    const annotations = page.annotations;
    if (annotations && annotations.length > 0) {
        lines.push("## Annotations");
        for (const a of annotations) {
            const status = a.status || "pending";
            const kind = a.kind || "note";
            lines.push(`- [${status}] (${kind}) by ${a.author}: ${a.text}`);
            if (a.section)
                lines.push(`  Section: ${a.section}`);
        }
        lines.push("");
    }
    return lines.join("\n");
}
//# sourceMappingURL=lib.js.map