import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import os from "os";
import fs from "fs/promises";

const exec = promisify(execFile);

const KAZAM_BIN = process.env.KAZAM_BIN || "kazam";
const SITES_ROOT = process.env.SITES_ROOT || "/data/sites";

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
