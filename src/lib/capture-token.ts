import { createHash, createHmac, timingSafeEqual } from "crypto";

// Stateless gate pass for the capture_thread -> create_page/write_page
// choreography (see capture-gate.ts and mcp-instructions.ts's CAPTURE
// section). Modeled on export-nonce.ts's role (a short-lived pass minted by
// one call and redeemed by another) but self-verifying rather than an
// in-memory Map: the token carries an HMAC-signed payload, so any server
// instance can verify it without a shared store, and it survives a process
// restart within its TTL.
//
// Signing key: prefer CAPTURE_TOKEN_SECRET, falling back to NEXTAUTH_SECRET
// when the deployment already set one (AUTH_MODE=oauth), then DATABASE_URL —
// every deployment has one and it's stable across restarts of the same
// environment — falling back to a fixed dev string only if neither is set
// (local AUTH_MODE=none dev/test runs).
//
// In production Clerk deployments (AUTH_MODE=clerk && NODE_ENV=production)
// this falls back chain is NOT safe: DATABASE_URL is not a secret scoped to
// this purpose, and multi-tenant cloud deployments must not silently sign
// capture tokens with it. Those deployments must set CAPTURE_TOKEN_SECRET (or
// NEXTAUTH_SECRET) explicitly — signingKey() throws rather than falling
// back to DATABASE_URL there.
const TTL_MS = 15 * 60 * 1000;

function signingKey(): string {
  const explicit = process.env.CAPTURE_TOKEN_SECRET || process.env.NEXTAUTH_SECRET;
  if (explicit) return explicit;
  if (process.env.AUTH_MODE === "clerk" && process.env.NODE_ENV === "production") {
    throw new Error(
      "CAPTURE_TOKEN_SECRET (or NEXTAUTH_SECRET) must be set when AUTH_MODE=clerk in production — refusing to fall back to DATABASE_URL for capture_token signing"
    );
  }
  return process.env.DATABASE_URL || "curata-capture-token-dev-fallback";
}

function contentFingerprint(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 32);
}

function sign(payloadB64: string): string {
  return createHmac("sha256", signingKey()).update(payloadB64).digest("hex");
}

interface CaptureTokenPayload {
  orgId: string;
  contentHash: string;
  exp: number;
}

/**
 * Mints a capture_token binding an org and a fingerprint of the captured
 * thread content, expiring after `ttlMs` (default 15 minutes). Returned by
 * capture_thread; redeemed by create_page/write_page when creating a page
 * whose required-components rule sets `captureRequired: true`.
 */
export function createCaptureToken(orgId: string, content: string, ttlMs: number = TTL_MS): string {
  const payload: CaptureTokenPayload = {
    orgId,
    contentHash: contentFingerprint(content),
    exp: Date.now() + ttlMs,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${payloadB64}.${sign(payloadB64)}`;
}

export type CaptureTokenCheck = { ok: true } | { ok: false; error: string };

/**
 * Verifies a capture_token against the calling org (always) and, when
 * `content` is supplied, against the fingerprint it was minted for. The
 * create-path gate (capture-gate.ts) only checks org + expiry — the page
 * being created is a distilled write, not a copy of the raw thread text, so
 * there's nothing meaningful to fingerprint-match at that point. The content
 * check exists for direct token round-trip verification (and any future
 * caller that does have the original thread text on hand).
 */
export function verifyCaptureToken(token: string | undefined, orgId: string, content?: string): CaptureTokenCheck {
  if (!token) return { ok: false, error: "capture_token is required" };
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, error: "malformed capture_token" };

  const [payloadB64, sig] = parts;
  const expectedSig = sign(payloadB64);
  const sigBuf = Buffer.from(sig, "hex");
  const expectedBuf = Buffer.from(expectedSig, "hex");
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return { ok: false, error: "invalid capture_token" };
  }

  let payload: CaptureTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return { ok: false, error: "malformed capture_token" };
  }

  if (typeof payload.exp !== "number" || Date.now() > payload.exp) {
    return { ok: false, error: "capture_token expired — run capture_thread again" };
  }
  if (payload.orgId !== orgId) {
    return { ok: false, error: "capture_token was minted for a different organization" };
  }
  if (content !== undefined && contentFingerprint(content) !== payload.contentHash) {
    return { ok: false, error: "capture_token does not match the captured content" };
  }

  return { ok: true };
}

export const CAPTURE_TOKEN_TTL_MS = TTL_MS;

// Single-use enforcement. The token itself is stateless/self-verifying (see
// verifyCaptureToken above), so it can be re-presented indefinitely until it
// expires unless something tracks "already redeemed" out of band. Mirrors
// export-nonce.ts's in-memory single-use Map, keyed by the token's signature
// (unique per mint — it covers orgId + contentHash + exp) rather than by the
// full token so a garbled/partial resubmission still normalizes to the same
// key. `globalThis`-backed so the store survives Next.js dev-mode module
// reloads within the same process.
//
// Limitation: this is a single-instance, in-process store — it does not
// coordinate across multiple server instances/pods. On a multi-instance
// deployment a token could be redeemed once per instance behind a load
// balancer. Fine for the OSS single-tenant deployment target; a shared store
// (e.g. Redis) would be needed to make this airtight on multi-instance cloud
// deployments.
const g = globalThis as unknown as { __consumedCaptureTokens?: Map<string, number> };
if (!g.__consumedCaptureTokens) g.__consumedCaptureTokens = new Map();
const consumedTokens = g.__consumedCaptureTokens;

const CONSUMED_STORE_CLEANUP_THRESHOLD = 5_000;

function tokenSignature(token: string): string | undefined {
  return token.split(".")[1];
}

/** Has this capture_token already been redeemed by a successful create? */
export function isCaptureTokenConsumed(token: string): boolean {
  const sig = tokenSignature(token);
  if (!sig) return false;
  const expiresAt = consumedTokens.get(sig);
  if (expiresAt === undefined) return false;
  if (Date.now() > expiresAt) {
    consumedTokens.delete(sig);
    return false;
  }
  return true;
}

/**
 * Marks a capture_token as redeemed so a second create can't reuse it.
 * Call only after a create fully succeeds (capture-gate.ts) — not on mere
 * verification, so a caller that fails a later check (e.g. missing
 * dedup_ack) can still retry with the same token.
 */
export function consumeCaptureToken(token: string, ttlMs: number = TTL_MS): void {
  const sig = tokenSignature(token);
  if (!sig) return;
  if (consumedTokens.size > CONSUMED_STORE_CLEANUP_THRESHOLD) {
    const now = Date.now();
    for (const [key, expiresAt] of consumedTokens) {
      if (now > expiresAt) consumedTokens.delete(key);
    }
  }
  consumedTokens.set(sig, Date.now() + ttlMs);
}
