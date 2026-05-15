import fs from "fs";
import path from "path";

const DOC_SLUGS = [
  "connecting-your-agent",
  "mcp-tools-reference",
  "page-structure",
  "self-hosting",
  "architecture",
];

export async function GET() {
  const docsDir = path.join(process.cwd(), "docs");
  const sections: string[] = [];

  for (const slug of DOC_SLUGS) {
    const filePath = path.join(docsDir, `${slug}.yaml`);
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      sections.push(`## ${slug}\n\n${raw}`);
    } catch {
      // skip missing files
    }
  }

  const content = sections.join("\n\n---\n\n");

  return new Response(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
