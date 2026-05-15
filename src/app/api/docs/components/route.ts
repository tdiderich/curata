import fs from "fs";
import path from "path";

export async function GET() {
  const filePath = path.join(process.cwd(), "docs", "agents-reference.md");
  const content = fs.readFileSync(filePath, "utf-8");

  return new Response(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
