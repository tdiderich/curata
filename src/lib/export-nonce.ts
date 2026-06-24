import { randomUUID } from "crypto";

type NonceEntry = { orgId: string; expires: number };

const g = globalThis as unknown as { __exportNonces?: Map<string, NonceEntry> };
if (!g.__exportNonces) g.__exportNonces = new Map();
const store = g.__exportNonces;

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
