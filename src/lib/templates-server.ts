import fs from "fs";
import path from "path";

export function getTemplateContent(slug: string): string | null {
  const base = path.join(process.cwd(), "demos", "templates");
  const flat = path.join(base, `${slug}.yaml`);
  try {
    return fs.readFileSync(flat, "utf-8");
  } catch {}
  try {
    for (const dir of fs.readdirSync(base, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const sub = path.join(base, dir.name, `${slug}.yaml`);
      try {
        return fs.readFileSync(sub, "utf-8");
      } catch {}
    }
  } catch {}
  return null;
}
