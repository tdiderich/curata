/**
 * Small pay-to-play signal for team-oriented surfaces (Groups tab, Members
 * tab, the approval-group picker). Every feature stays fully usable on
 * every plan — this is a hint, never a gate. Only rendered by callers when
 * entitlements come back finite, so self-hosted deployments never show it.
 */
export function TeamChip() {
  return <span className="pill pill--mono pill--team">Team</span>;
}
