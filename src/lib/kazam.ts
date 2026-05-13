import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import os from "os";
import fs from "fs/promises";
import yaml from "js-yaml";

const exec = promisify(execFile);

const KAZAM_BIN = process.env.KAZAM_BIN || "kazam";
const SITES_ROOT = process.env.SITES_ROOT || "/data/sites";

const UNSUPPORTED_COMPONENTS = new Set(["chart"]);

export function sitePath(orgSlug: string): string {
  return path.join(SITES_ROOT, orgSlug);
}

export interface ValidationError {
  file: string;
  path: string;
  error_type: string;
  message: string;
  suggestion?: string;
}

export async function validatePage(orgSlug: string, slug: string): Promise<ValidationError[]> {
  const filePath = path.join(sitePath(orgSlug), `${slug}.yaml`);
  return validateFile(filePath);
}

export async function validateContent(orgSlug: string, slug: string, content: string): Promise<ValidationError[]> {
  const tmpDir = path.join(os.tmpdir(), `curata-validate-${Date.now()}`);
  const tmpPath = path.join(tmpDir, `${path.basename(slug)}.yaml`);
  try {
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(tmpPath, content);
    return await validateFile(tmpPath);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

export function checkUnsupportedComponents(content: string): ValidationError[] {
  let doc: Record<string, unknown>;
  try {
    doc = yaml.load(content) as Record<string, unknown>;
  } catch {
    return [];
  }
  if (!doc || typeof doc !== "object") return [];

  const errors: ValidationError[] = [];
  const walk = (items: unknown[], jsonPath: string) => {
    if (!Array.isArray(items)) return;
    for (let i = 0; i < items.length; i++) {
      const c = items[i] as Record<string, unknown> | null;
      if (!c || typeof c !== "object") continue;
      const t = c.type as string | undefined;
      if (t && UNSUPPORTED_COMPONENTS.has(t)) {
        errors.push({
          file: "",
          path: `${jsonPath}[${i}]`,
          error_type: "unsupported_component",
          message: `"${t}" is not supported in curata — it requires kazam's build-time SVG renderer. Use table, stat_grid, or progress_bar instead. Call get_component_reference for alternatives.`,
        });
      }
      if (Array.isArray(c.components)) walk(c.components, `${jsonPath}[${i}].components`);
      if (Array.isArray(c.tabs)) {
        (c.tabs as Record<string, unknown>[]).forEach((tab, ti) => {
          if (Array.isArray(tab.components)) walk(tab.components, `${jsonPath}[${i}].tabs[${ti}].components`);
        });
      }
      if (Array.isArray(c.items)) {
        (c.items as Record<string, unknown>[]).forEach((item, ii) => {
          if (Array.isArray(item.components)) walk(item.components, `${jsonPath}[${i}].items[${ii}].components`);
        });
      }
      if (Array.isArray(c.columns)) {
        (c.columns as unknown[]).forEach((col, ci) => {
          if (Array.isArray(col)) walk(col, `${jsonPath}[${i}].columns[${ci}]`);
        });
      }
    }
  };

  if (Array.isArray(doc.components)) walk(doc.components, "components");
  if (Array.isArray(doc.slides)) {
    (doc.slides as Record<string, unknown>[]).forEach((slide, si) => {
      if (Array.isArray(slide.components)) walk(slide.components, `slides[${si}].components`);
    });
  }

  return errors;
}

async function validateFile(filePath: string): Promise<ValidationError[]> {
  try {
    const { stdout } = await exec(KAZAM_BIN, ["validate", path.dirname(filePath)], {
      timeout: 10_000,
    });
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err: unknown) {
    if (err instanceof Error) {
      const e = err as { stdout?: string; stderr?: string };
      if (e.stdout) {
        try {
          const parsed = JSON.parse(e.stdout);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          // stdout wasn't JSON
        }
      }
      if (e.stderr?.trim()) {
        return [{
          file: filePath,
          path: "",
          error_type: "format",
          message: e.stderr.trim(),
        }];
      }
    }
    return [{
      file: filePath,
      path: "",
      error_type: "format",
      message: "validation failed",
    }];
  }
}
