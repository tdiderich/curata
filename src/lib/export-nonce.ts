import { randomUUID } from "crypto";

const store = new Map<string, { orgId: string; expires: number }>();

const TTL_MS = 30_000;

export function createExportNonce(orgId: string): string {
  const nonce = randomUUID();
  store.set(nonce, { orgId, expires: Date.now() + TTL_MS });
  return nonce;
}

export function consumeExportNonce(nonce: string): string | null {
  const entry = store.get(nonce);
  if (!entry) return null;
  store.delete(nonce);
  if (Date.now() > entry.expires) return null;
  return entry.orgId;
}
