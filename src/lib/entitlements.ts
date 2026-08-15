/**
 * Overlay seam: this file is the deliberate integration point for hosted
 * forks to wire a billing provider. Self-hosted (OSS) deployments always
 * get the unlimited default below, so nothing is ever gated for them.
 *
 * A hosted fork replaces this file wholesale (see curata-app's
 * extensions/src/lib/entitlements.ts) to look up the org's plan and
 * return a finite maxMembers. Keep this file free of imports beyond
 * types — an overlay swap should never risk breaking an unrelated OSS
 * import elsewhere in the app.
 */
export interface Entitlements {
  maxMembers: number;
  /** Estimated-token cap across the org's active pages ("brain size"). */
  maxBrainTokens: number;
}

export async function getEntitlements(orgId: string): Promise<Entitlements> {
  void orgId; // signature parity with the hosted overlay, which does key off orgId
  return { maxMembers: Number.POSITIVE_INFINITY, maxBrainTokens: Number.POSITIVE_INFINITY };
}
