import fs from "fs";
import path from "path";

export function getTemplateContent(slug: string): string | null {
  const filePath = path.join(process.cwd(), "demos", "templates", `${slug}.yaml`);
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}
