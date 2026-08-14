import { extractDeclaredPageType, isCaptureRequired } from "@/lib/required-components";
import type { ResolvedRequiredComponentsRule } from "@/lib/required-components";
import { verifyCaptureToken, isCaptureTokenConsumed, consumeCaptureToken } from "@/lib/capture-token";

const CHOREOGRAPHY_HINT =
  'run capture_thread first, review its dedup_candidates, then create with the returned capture_token and a dedup_ack ("new" if none matched, or the candidate slug to update via patch_page instead)';

/**
 * The create-path gate: given the content about to be created and the
 * already-resolved required-components rules in scope, throws unless the
 * page's declared pageType isn't gated at all, or the caller supplied a
 * valid capture_token plus a dedup_ack. Only ever called from a *create*
 * (create_page, or write_page when the slug doesn't exist yet) — updates to
 * an existing page never call this.
 *
 * Takes already-resolved rules rather than re-querying so callers that just
 * ran the required-components shape check (which needs the same resolved
 * rules) don't pay for a second DB round trip.
 */
export function enforceCaptureGate(opts: {
  orgId: string;
  content: string;
  resolvedRules: ResolvedRequiredComponentsRule[];
  captureToken?: string;
  dedupAck?: string;
}): void {
  const declaredType = extractDeclaredPageType(opts.content);
  if (!declaredType) return;
  if (!isCaptureRequired(opts.resolvedRules, declaredType)) return;

  if (!opts.captureToken) {
    throw new Error(`page type "${declaredType}" requires the capture_thread choreography before creation — ${CHOREOGRAPHY_HINT}`);
  }
  const tokenCheck = verifyCaptureToken(opts.captureToken, opts.orgId);
  if (!tokenCheck.ok) {
    throw new Error(`invalid capture_token (${tokenCheck.error}) — ${CHOREOGRAPHY_HINT}`);
  }
  if (isCaptureTokenConsumed(opts.captureToken)) {
    throw new Error("capture_token already used — run capture_thread again");
  }
  // dedup_ack is deliberately honor-system: the server never verifies "new"
  // against the actual candidate list. The token already proves
  // capture_thread ran, and the candidates arrive in the same tool response
  // as the token, so a cooperative agent has necessarily seen them. Binding
  // the ack cryptographically would only defend against a malicious agent,
  // which holds a write key and can vandalize pages regardless — this gate
  // is data-quality choreography, not a security boundary (decided
  // 2026-08-14; revisit only if dogfood shows duplicate abuse).
  if (!opts.dedupAck) {
    throw new Error(`dedup_ack is required alongside capture_token — ${CHOREOGRAPHY_HINT}`);
  }
  if (opts.dedupAck !== "new") {
    throw new Error(`update "${opts.dedupAck}" via patch_page instead of creating a new page — capture_thread flagged it as a likely duplicate`);
  }
  // Single-use: only mark the token spent once every check above has passed,
  // so a caller that supplied a valid token but forgot dedup_ack (or named a
  // duplicate) can still retry with the same token instead of being forced
  // back through capture_thread.
  consumeCaptureToken(opts.captureToken);
}
