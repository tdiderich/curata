import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import os from "os";
import fs from "fs/promises";
import { existsSync } from "fs";
import yaml from "js-yaml";

const exec = promisify(execFile);

// Prefer the binary pnpm generate used, so the renderer, the reference,
// and validation all come from the same kazam build. PATH is the fallback.
function resolveKazamBin(): string {
  if (process.env.KAZAM_BIN) return process.env.KAZAM_BIN;
  const local = path.join(process.cwd(), ".bin", "kazam");
  return existsSync(local) ? local : "kazam";
}
const KAZAM_BIN = resolveKazamBin();
const SITES_ROOT = process.env.SITES_ROOT || "/data/sites";

const UNSUPPORTED_COMPONENTS = new Set<string>([]);

export function sitePath(orgSlug: string): string {
  return path.join(SITES_ROOT, orgSlug);
}

/**
 * kazam validate deserializes page content into its Page struct — content
 * that isn't YAML at all, or YAML that doesn't parse into the page shape
 * (a bare string, a list, prose pasted straight in), surfaces as a raw serde
 * error like "invalid type: string, expected struct Page". That's meaningless
 * to an agent that doesn't know kazam is a Rust binary under the hood.
 * Prefixes a sentence pointing at the actual authoring references, keeping
 * the raw detail after it so nothing is lost for a human debugging the CLI
 * itself.
 */
export function invalidContentMessage(detail: string): string {
  return `content must be curata page YAML (title/shell/components) - call get_component_reference or read the page-structure page for the format: ${detail}`;
}

export interface ValidationError {
  file: string;
  path: string;
  error_type: string;
  message: string;
  suggestion?: string;
  /** "error" fails the write; "warning" (shape rules) is returned with it. Older binaries omit it. */
  severity?: "error" | "warning";
}

export interface ShapeWarning {
  path: string;
  component: string;
  message: string;
  rule?: string;
  scope: string;
}

export interface SplitValidation {
  errors: ValidationError[];
  warnings: ShapeWarning[];
}

export function isValidationWarning(e: ValidationError): boolean {
  return e.severity === "warning";
}

/** Shape warnings as agents should read them: path, component, what to fix. */
export function toShapeWarnings(errors: ValidationError[]): ShapeWarning[] {
  return errors.filter(isValidationWarning).map((e) => {
    const [component, ...rest] = e.message.split(": ");
    const rule = e.suggestion?.startsWith("rule: ") ? e.suggestion.slice("rule: ".length) : undefined;
    return {
      path: e.path,
      component: rest.length > 0 ? component : "page",
      message: rest.length > 0 ? rest.join(": ") : e.message,
      ...(rule ? { rule } : {}),
      scope: e.error_type === "shape" ? "schema" : e.error_type,
    };
  });
}

/**
 * Leading block for write responses so a warning cannot be missed. Empty
 * string when there is nothing to say.
 */
export function formatWarningsBlock(warnings: ShapeWarning[]): string {
  if (warnings.length === 0) return "";
  const lines = warnings.map((w) => `- ${w.path} (${w.component}): ${w.message}${w.rule ? ` [rule: ${w.rule}]` : ""}`);
  return `WARNINGS (${warnings.length}) - the page was written; fix these in a follow-up edit:\n${lines.join("\n")}\n\n`;
}

export async function validatePage(orgSlug: string, slug: string): Promise<ValidationError[]> {
  const filePath = path.join(sitePath(orgSlug), `${slug}.yaml`);
  return validateFile(filePath);
}

/**
 * Validate page YAML with kazam. `siteRules` (org shape rules) are written
 * as a kazam.yaml next to the page so the Rust engine evaluates them with
 * the built-in set. Returns blocking errors and non-blocking shape warnings
 * separately.
 */
export async function validateContentSplit(
  orgSlug: string,
  slug: string,
  content: string,
  siteRules: Array<Record<string, string>> = []
): Promise<SplitValidation> {
  const tmpDir = path.join(os.tmpdir(), `curata-validate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const tmpPath = path.join(tmpDir, `${path.basename(slug)}.yaml`);
  try {
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(tmpPath, content);
    await fs.writeFile(
      path.join(tmpDir, "kazam.yaml"),
      yaml.dump({ name: orgSlug || "curata", shape_rules: siteRules }, { lineWidth: -1 })
    );
    const all = await validateFile(tmpPath);
    return {
      errors: all.filter((e) => !isValidationWarning(e)),
      warnings: toShapeWarnings(all),
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Blocking errors only. Prefer validateContentSplit on write paths so warnings reach the caller. */
export async function validateContent(orgSlug: string, slug: string, content: string): Promise<ValidationError[]> {
  return (await validateContentSplit(orgSlug, slug, content)).errors;
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
