import fs from "fs";
import path from "path";

// The AGL execution-semantics primer, emitted at build time by
// `kazam agl reference` (see the generate script). Agents reading a skill
// page's ```agl fence fetch this to learn how to execute the graph —
// gates, invariants, fan bounds and all.
export async function GET() {
  const filePath = path.join(process.cwd(), "docs", "agl-reference.md");
  let body: string;
  try {
    body = fs.readFileSync(filePath, "utf-8");
  } catch {
    body = "AGL reference not available in this build.";
  }
  return new Response(body, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
