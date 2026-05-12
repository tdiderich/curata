import { randomBytes, createHash } from "crypto";

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  const prefix = raw.slice(0, 8);
  const key = `ck_${raw}`;
  const hash = createHash("sha256").update(key).digest("hex");
  return { key, prefix, hash };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
