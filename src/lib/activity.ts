// Turns raw AuditLog rows into a session-rolled-up activity feed for the
// dashboard: consecutive actions by the same actor within a short window
// collapse into one line ("left 2 comments on X and 1 comment on Y") instead
// of one row per audit entry, which is unreadable once an agent does a burst
// of writes.
//
// Page-related actions carry the page slug either in `metadata` (added
// later, more consistent) or as `resourceId` (the earlier, plainer
// convention) — share/link actions instead put the page's DB id in
// resourceId, so metadata.slug is checked first and resourceId is only a
// fallback for the actions that never had a metadata.slug to begin with.

export interface ActivityRow {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string;
  actorType: string;
  actorId: string;
  metadata: unknown;
  createdAt: Date;
}

export interface ActivityPart {
  text: string;
  href: string | null;
}

export type ActivityIcon = "comment" | "edit" | "create" | "flag" | "delete" | "rules" | "folder" | "key";
export type ActivityTone = "accent" | "yellow" | "red";

export interface ActivityEntry {
  id: string;
  actorLabel: string;
  isAgent: boolean;
  timeLabel: string;
  createdAt: Date;
  icon: ActivityIcon;
  tone: ActivityTone;
  parts: ActivityPart[];
}

// Actions by the same actor more than this far apart start a new session —
// long enough to hold a burst of MCP writes, short enough that "session"
// still means one sitting.
const SESSION_GAP_MS = 20 * 60 * 1000;

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
function numberWord(n: number): string {
  return n < NUMBER_WORDS.length ? NUMBER_WORDS[n] : String(n);
}

function meta(metadata: unknown): Record<string, unknown> {
  return (metadata && typeof metadata === "object" ? metadata : {}) as Record<string, unknown>;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function relTime(d: Date): string {
  const mins = (Date.now() - d.getTime()) / 60000;
  if (mins < 1) return "just now";
  if (mins < 60) return `${Math.floor(mins)}m ago`;
  const hours = mins / 60;
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  const days = hours / 24;
  if (days < 30) return `${Math.floor(days)}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// apikey rows carry the ApiKey's `prefix` (an 8-char base64url string, e.g.
// "_ZdcUBAJ") as actorId — see resolveOrgFromApiKey in auth.ts, threaded
// through as ctx.keyPrefix into the actorId param on every apikey-tagged
// logAudit() call. Non-key MCP actors (tailscale/oauth/dev) reuse the same
// actorType/actorId plumbing with sentinel values ("ts:user", "oauth:...",
// "noauth", "dev") that never match a real key, so the map lookup harmlessly
// falls through to the raw id for those too.
function actorLabel(row: ActivityRow, apiKeyNamesByPrefix?: Map<string, string>): string {
  if (row.actorType === "apikey") return apiKeyNamesByPrefix?.get(row.actorId) ?? row.actorId;
  return row.actorId.replace(/^ts:/, "");
}

interface Target {
  label: string;
  href: string | null;
}

function resolveTarget(row: ActivityRow, pagesBySlug: Map<string, string>): Target | null {
  const m = meta(row.metadata);
  switch (row.resourceType) {
    case "page":
    case "annotation": {
      const slug = str(m.slug) ?? row.resourceId;
      const title = pagesBySlug.get(slug);
      return title ? { label: title, href: `/pages/${slug}` } : null;
    }
    case "folder":
      return { label: str(m.name) ?? str(m.folderName) ?? row.resourceId, href: null };
    case "apikey":
      return { label: str(m.name) ?? row.resourceId, href: null };
    case "organization":
      return { label: "global", href: null };
    default:
      return null;
  }
}

function textPart(text: string): ActivityPart {
  return { text, href: null };
}

function targetPart(target: Target): ActivityPart {
  return { text: target.label, href: target.href };
}

// Separator before item `i` of `total` in an oxford-joined list: no comma
// before "and" when there are only two items ("X and Y", not "X, and Y").
function joinSep(i: number, total: number): string {
  if (i === 0) return "";
  if (i < total - 1) return ", ";
  return total === 2 ? " and " : ", and ";
}

// Full clause for a one-off action — the common case, and richer than the
// rollup phrasing (keeps flag reasons, comment status, share targets, etc).
// Built as parts directly (not a string) so the target's link lands in the
// right spot even when it's mid-sentence (share.create, page.flag).
function singularParts(action: string, metadata: unknown, resourceId: string, target: Target | null): ActivityPart[] | null {
  const m = meta(metadata);
  const t = target ? targetPart(target) : null;
  switch (action) {
    case "page.create": return t && [textPart("created "), t];
    case "page.write":
    case "page.patch":
    case "page.replace": return t && [textPart("edited "), t];
    case "page.move": return t && [textPart("moved "), t];
    case "page.restore": return t && [textPart("restored a previous version of "), t];
    case "page.flag":
      return t && [textPart("flagged "), t, textPart(` as ${str(m.action) ?? "cleanup"}${str(m.reason) ? ` — ${str(m.reason)}` : ""}`)];
    case "flag.archive": return t && [textPart("archived "), t];
    case "flag.delete": return t && [textPart("deleted "), t];
    case "flag.keep": return t && [textPart("dismissed a cleanup flag on "), t];
    case "flag.snooze": return t && [textPart("snoozed a cleanup flag on "), t];
    case "annotation.create": return t && [textPart("commented on "), t];
    case "annotation.update": return t && [textPart(`marked a comment ${str(m.status) ?? "updated"} on `), t];
    case "folder.create": return [textPart(`created folder ${str(m.name) ?? resourceId}`)];
    case "folder.update": return [textPart(`updated folder ${str(m.name) ?? str(m.folderName) ?? resourceId}`)];
    case "apikey.create": return [textPart(`created API key ${str(m.name) ?? resourceId}`)];
    case "apikey.revoke": return [textPart(`revoked API key ${str(m.name) ?? resourceId}`)];
    case "link.create": return [textPart("created a share link for "), t ?? textPart("a page")];
    case "link.revoke": return [textPart("revoked a share link for "), t ?? textPart("a page")];
    case "share.create": return t && [textPart("shared "), t, textPart(` with ${str(m.targetUserId) ?? "someone"}`)];
    case "share.revoke": return t && [textPart(`removed ${str(m.targetUserId) ?? "a user"}'s access to `), t];
    case "rules.set": return [textPart(`updated content rules (${str(m.scope) ?? "org"})`)];
    default: return null;
  }
}

type RollupMode = "count" | "list";
interface RollupSpec {
  mode: RollupMode;
  lead: string;
  singular?: string;
  plural: string;
}

// How a burst of the same action rolls up. "count" actions can stack on one
// target ("2 comments on X"); "list" actions each hit a fresh target, so a
// burst reads as a list ("moved 3 pages: A, B, and C").
const ROLLUP: Record<string, RollupSpec> = {
  "annotation.create": { mode: "count", lead: "left", singular: "comment", plural: "comments" },
  "annotation.update": { mode: "count", lead: "made", singular: "comment update", plural: "comment updates" },
  "page.write": { mode: "count", lead: "made", singular: "edit", plural: "edits" },
  "page.patch": { mode: "count", lead: "made", singular: "edit", plural: "edits" },
  "page.replace": { mode: "count", lead: "made", singular: "edit", plural: "edits" },
  "page.create": { mode: "list", lead: "created", plural: "pages" },
  "page.move": { mode: "list", lead: "moved", plural: "pages" },
  "page.restore": { mode: "list", lead: "restored versions of", plural: "pages" },
  "page.flag": { mode: "list", lead: "flagged", plural: "pages" },
  "flag.archive": { mode: "list", lead: "archived", plural: "pages" },
  "flag.delete": { mode: "list", lead: "deleted", plural: "pages" },
  "flag.keep": { mode: "list", lead: "dismissed cleanup flags on", plural: "pages" },
  "flag.snooze": { mode: "list", lead: "snoozed cleanup flags on", plural: "pages" },
  "folder.create": { mode: "list", lead: "created", plural: "folders" },
  "folder.update": { mode: "list", lead: "updated", plural: "folders" },
  "apikey.create": { mode: "list", lead: "created", plural: "API keys" },
  "apikey.revoke": { mode: "list", lead: "revoked", plural: "API keys" },
  "link.create": { mode: "list", lead: "created share links for", plural: "pages" },
  "link.revoke": { mode: "list", lead: "revoked share links for", plural: "pages" },
  "share.create": { mode: "list", lead: "shared", plural: "pages" },
  "share.revoke": { mode: "list", lead: "removed access to", plural: "pages" },
  "rules.set": { mode: "list", lead: "updated content rules for", plural: "scopes" },
};

// Icon + severity tone shown per action bucket in the grouped changelog. Not
// exhaustive by design — falls back to a plain "edit" glyph for anything new.
const ACTION_META: Record<string, { icon: ActivityIcon; tone: ActivityTone }> = {
  "annotation.create": { icon: "comment", tone: "accent" },
  "annotation.update": { icon: "comment", tone: "accent" },
  "page.write": { icon: "edit", tone: "accent" },
  "page.patch": { icon: "edit", tone: "accent" },
  "page.replace": { icon: "edit", tone: "accent" },
  "page.move": { icon: "edit", tone: "accent" },
  "page.restore": { icon: "edit", tone: "accent" },
  "page.create": { icon: "create", tone: "accent" },
  "folder.create": { icon: "folder", tone: "accent" },
  "folder.update": { icon: "folder", tone: "accent" },
  "apikey.create": { icon: "key", tone: "accent" },
  "apikey.revoke": { icon: "key", tone: "red" },
  "link.create": { icon: "create", tone: "accent" },
  "link.revoke": { icon: "delete", tone: "red" },
  "share.create": { icon: "create", tone: "accent" },
  "share.revoke": { icon: "delete", tone: "red" },
  "page.flag": { icon: "flag", tone: "yellow" },
  "flag.keep": { icon: "flag", tone: "yellow" },
  "flag.snooze": { icon: "flag", tone: "yellow" },
  "flag.archive": { icon: "delete", tone: "red" },
  "flag.delete": { icon: "delete", tone: "red" },
  "rules.set": { icon: "rules", tone: "accent" },
};
const DEFAULT_ACTION_META: { icon: ActivityIcon; tone: ActivityTone } = { icon: "edit", tone: "accent" };

interface RowInfo {
  id: string;
  createdAt: Date;
  actorKey: string;
  actorLabel: string;
  isAgent: boolean;
  action: string;
  metadata: unknown;
  resourceId: string;
  target: Target | null;
}

// One action bucket (all rows in a session sharing the same `action`) → the
// parts for its clause, e.g. ["left ", "2 comments on ", link("X"), " and ", "1 comment on ", link("Y")].
function renderBucket(action: string, rows: RowInfo[]): ActivityPart[] {
  if (rows.length === 1) {
    const r = rows[0];
    return singularParts(action, r.metadata, r.resourceId, r.target) ?? [textPart(`${action}`)];
  }

  // Group by target, preserving first-seen order.
  const byTarget = new Map<string, { target: Target | null; count: number }>();
  for (const r of rows) {
    const key = r.target?.label ?? "__none";
    const existing = byTarget.get(key);
    if (existing) existing.count += 1;
    else byTarget.set(key, { target: r.target, count: 1 });
  }
  const buckets = [...byTarget.values()];

  const spec = ROLLUP[action];
  if (!spec) {
    // Unknown action: generic "×N" fallback per target.
    const parts: ActivityPart[] = [textPart(`${action} `)];
    buckets.forEach((b, i) => {
      const sep = joinSep(i, buckets.length);
      if (sep) parts.push(textPart(sep));
      if (b.target) parts.push(targetPart(b.target));
      if (b.count > 1) parts.push(textPart(` ×${b.count}`));
    });
    return parts;
  }

  if (spec.mode === "count") {
    const parts: ActivityPart[] = [textPart(`${spec.lead} `)];
    buckets.forEach((b, i) => {
      const sep = joinSep(i, buckets.length);
      if (sep) parts.push(textPart(sep));
      const n = b.count;
      const noun = n === 1 ? spec.singular ?? spec.plural : spec.plural;
      parts.push(textPart(`${numberWord(n)} ${noun}`));
      if (b.target) {
        parts.push(textPart(" on "));
        parts.push(targetPart(b.target));
      }
    });
    return parts;
  }

  // "list" mode: every row is its own target (bursts of one-per-target
  // actions), so just name them.
  const parts: ActivityPart[] = [textPart(`${spec.lead} ${numberWord(rows.length)} ${spec.plural}: `)];
  buckets.forEach((b, i) => {
    const sep = joinSep(i, buckets.length);
    if (sep) parts.push(textPart(sep));
    if (b.target) parts.push(targetPart(b.target));
    else parts.push(textPart("an item"));
  });
  return parts;
}

export function buildActivitySessions(
  rows: ActivityRow[],
  pagesBySlug: Map<string, string>,
  apiKeyNamesByPrefix?: Map<string, string>,
): ActivityEntry[] {
  const infos: RowInfo[] = [];
  for (const row of rows) {
    const target = resolveTarget(row, pagesBySlug);
    // Drop rows we truly can't describe — a bare unlabeled row is worse than
    // a missing one. Actions with a fixed phrasing (folder/apikey/rules) or
    // a rollup spec survive even without a resolvable target.
    if (target === null && singularParts(row.action, row.metadata, row.resourceId, null) === null && !ROLLUP[row.action]) continue;
    infos.push({
      id: row.id,
      createdAt: row.createdAt,
      actorKey: `${row.actorType}:${row.actorId}`,
      actorLabel: actorLabel(row, apiKeyNamesByPrefix),
      isAgent: row.actorType === "apikey",
      action: row.action,
      metadata: row.metadata,
      resourceId: row.resourceId,
      target,
    });
  }

  // Rows arrive newest-first; walk them in that order and close a session
  // when the actor changes or too much time has passed since the last item.
  const sessions: RowInfo[][] = [];
  for (const info of infos) {
    const current = sessions[sessions.length - 1];
    const prev = current?.[current.length - 1];
    if (prev && prev.actorKey === info.actorKey && prev.createdAt.getTime() - info.createdAt.getTime() <= SESSION_GAP_MS) {
      current.push(info);
    } else {
      sessions.push([info]);
    }
  }

  // One entry per (session, action type) — a session mixing comments and
  // page moves reads as two changelog lines, each with its own icon, rather
  // than one run-on sentence.
  return sessions.flatMap((session) => {
    const byAction = new Map<string, RowInfo[]>();
    for (const r of session) {
      const list = byAction.get(r.action) ?? [];
      list.push(r);
      byAction.set(r.action, list);
    }

    return [...byAction.entries()].map(([action, actionRows], i): ActivityEntry => {
      const { icon, tone } = ACTION_META[action] ?? DEFAULT_ACTION_META;
      return {
        id: `${session[0].id}:${i}`,
        actorLabel: session[0].actorLabel,
        isAgent: session[0].isAgent,
        timeLabel: relTime(session[0].createdAt),
        createdAt: session[0].createdAt,
        icon,
        tone,
        parts: renderBucket(action, actionRows),
      };
    });
  });
}
