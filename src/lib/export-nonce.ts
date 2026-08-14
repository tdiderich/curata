// Short-lived pass minted by createExportNonce (export-render.ts, on the
// export/export_page path) and redeemed once by the export-preview page. The
// nonce is HMAC-signed so `src/middleware.ts` can verify it was minted by
// this server — and hasn't expired — from the edge runtime, which cannot see
// the in-memory single-use store below (a separate isolate/process from the
// one that created the nonce). Verifying the signature only proves the nonce
// is genuine and unexpired; it does not prove the nonce hasn't already been
// used. Single-use is enforced by consumeExportNonce, which does have the
// store, and only runs on the page itself.
//
// Signing key: mirrors capture-token.ts's fallback chain — prefer a
// dedicated secret (EXPORT_SECRET), then NEXTAUTH_SECRET (set whenever
// AUTH_MODE=oauth), then DATABASE_URL (stable per environment), and only
// fall back to a fixed dev string when none of those are configured (local
// AUTH_MODE=none dev/test runs).
//
// In production Clerk deployments (AUTH_MODE=clerk && NODE_ENV=production)
// the DATABASE_URL fallback is not acceptable — see capture-token.ts for the
// same reasoning. Those deployments must set EXPORT_SECRET (or
// NEXTAUTH_SECRET) explicitly; signingSecret() throws instead of falling
// back there.
//
// Uses Web Crypto (globalThis.crypto) rather than node:crypto so the same
// verify path works unmodified in both the Node.js request handlers and the
// edge-runtime middleware.

type NonceEntry = { orgId: string; slug: string; hub?: string; expires: number };

const g = globalThis as unknown as { __exportNonces?: Map<string, NonceEntry> };
if (!g.__exportNonces) g.__exportNonces = new Map();
const store = g.__exportNonces;

const TTL_MS = 30_000;

function signingSecret(): string {
  const explicit = process.env.EXPORT_SECRET || process.env.NEXTAUTH_SECRET;
  if (explicit) return explicit;
  if (process.env.AUTH_MODE === "clerk" && process.env.NODE_ENV === "production") {
    throw new Error(
      "EXPORT_SECRET (or NEXTAUTH_SECRET) must be set when AUTH_MODE=clerk in production — refusing to fall back to DATABASE_URL for export-nonce signing"
    );
  }
  return process.env.DATABASE_URL || "curata-export-nonce-dev-fallback";
}

function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBuf(hex: string): Uint8Array<ArrayBuffer> | null {
  if (hex.length === 0 || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) return null;
    out[i] = byte;
  }
  return out;
}

async function sign(payload: string): Promise<string> {
  const key = await hmacKey();
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return bufToHex(sig);
}

/**
 * Mints an export-preview nonce for `orgId`, bound to the specific `slug`
 * (and `hub`, when the render path carries one) it was minted for: a random
 * id plus expiry, tracked in the single-use store and returned as
 * `<id>.<expires>.<hmac>` so the signature travels with it. The slug/hub
 * binding lives in the store entry (not the signed payload) — verifying the
 * signature only proves the nonce is genuine and unexpired (that's all the
 * edge middleware needs); consumeExportNonce is what enforces that the URL's
 * slug actually matches what this nonce was minted for.
 */
export async function createExportNonce(orgId: string, slug: string, hub?: string): Promise<string> {
  const id = crypto.randomUUID();
  const expires = Date.now() + TTL_MS;
  store.set(id, { orgId, slug, hub, expires });
  const payload = `${id}.${expires}`;
  return `${payload}.${await sign(payload)}`;
}

/**
 * Stateless check: was this nonce signed by this server, and has it not yet
 * expired? Safe to call from edge middleware, which has no access to the
 * in-memory store. Does not check (or consume) single-use — see
 * consumeExportNonce for that.
 */
export async function verifyExportNonceSignature(nonce: string): Promise<boolean> {
  const parts = nonce.split(".");
  if (parts.length !== 3) return false;
  const [id, expiresStr, sig] = parts;
  if (!id || !expiresStr) return false;
  const expires = Number(expiresStr);
  if (!Number.isFinite(expires) || Date.now() > expires) return false;

  const sigBuf = hexToBuf(sig);
  if (!sigBuf) return false;

  const key = await hmacKey();
  return crypto.subtle.verify(
    "HMAC",
    key,
    sigBuf,
    new TextEncoder().encode(`${id}.${expiresStr}`),
  );
}

export interface ConsumedExportNonce {
  orgId: string;
  slug: string;
  hub?: string;
}

/**
 * Redeems a nonce for its org id/slug/hub, single-use: verifies the
 * signature and expiry, then checks and deletes the store entry. Returns
 * null if the nonce is invalid, expired, or already consumed. Callers (the
 * export-preview page) must additionally check the returned slug/hub match
 * the URL they were called on — this only proves the nonce is genuine, not
 * that it was minted for this particular page.
 */
export async function consumeExportNonce(nonce: string): Promise<ConsumedExportNonce | null> {
  if (!(await verifyExportNonceSignature(nonce))) return null;
  const id = nonce.split(".")[0];
  const entry = store.get(id);
  if (!entry) return null;
  store.delete(id);
  if (Date.now() > entry.expires) return null;
  return { orgId: entry.orgId, slug: entry.slug, hub: entry.hub };
}
