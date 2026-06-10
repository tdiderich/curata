// 72h matches the design doc's staleness criterion: past this, the
// narrative gets a visible "may be outdated" banner instead of silently
// presenting stale content as current.
export const STALE_AFTER_HOURS = 72;

export function formatRefreshAge(
  updatedAt: Date,
  now: Date = new Date()
): { label: string; stale: boolean } {
  const ms = now.getTime() - updatedAt.getTime();
  const hours = ms / (1000 * 60 * 60);
  const stale = hours > STALE_AFTER_HOURS;
  if (hours < 1) return { label: "just now", stale };
  if (hours < 24) return { label: `${Math.floor(hours)}h ago`, stale };
  return { label: `${Math.floor(hours / 24)}d ago`, stale };
}
