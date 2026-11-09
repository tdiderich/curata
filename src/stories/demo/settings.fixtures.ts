// Fixture answers for the settings help video (Demo/Settings). Believable
// org data only: key prefixes are fake and never complete keys.

export const ORG = { name: "Acme", slug: "acme", domain: "acme.com", logoUrl: "", hasLogo: false };

export const members = [
  { id: "m1", userId: "u-dana", email: "dana@acme.com", role: "owner" },
  { id: "m2", userId: "u-sam", email: "sam@acme.com", role: "admin" },
  { id: "m3", userId: "u-priya", email: "priya@acme.com", role: "member" },
  { id: "m4", userId: "u-alex", email: "alex@acme.com", role: "member" },
  { id: "m5", userId: "u-jo", email: "jo@acme.com", role: "viewer" },
];

export const groups = [
  { id: "g1", name: "Engineering", slug: "engineering", memberCount: 3, members: [{ userId: "u-sam", role: "owner" }, { userId: "u-priya", role: "member" }, { userId: "u-alex", role: "member" }] },
  { id: "g2", name: "Customer Success", slug: "customer-success", memberCount: 2, members: [{ userId: "u-dana", role: "owner" }, { userId: "u-jo", role: "member" }] },
];

export const tags = [
  { id: "c1", term: "engineering", kind: "topic", pageCount: 14 },
  { id: "c2", term: "how-it-works", kind: "topic", pageCount: 9 },
  { id: "c3", term: "customers", kind: "topic", pageCount: 7 },
  { id: "c4", term: "postgres", kind: "vendor", pageCount: 4 },
  { id: "c5", term: "runbook", kind: "template", pageCount: 3 },
  { id: "c6", term: "soc2", kind: "framework", pageCount: 2 },
];

export const globalRules = [
  { id: "r-secrets", text: "Never include API keys, tokens, or passwords", mode: "block" as const, patterns: ["ck_[A-Za-z0-9]{24,}"] },
  { id: "r-source", text: "Cite the source file or ticket for every technical claim", mode: "warn" as const },
  { id: "r-owner", text: "Runbooks name an owner and a rollback step", mode: "warn" as const },
];

export const apiKeys = [
  { id: "k1", name: "CI docs sync", prefix: "ck_7f3a", scopes: ["read", "write"], createdAt: "2026-10-14T15:00:00.000Z", expiresAt: null },
  { id: "k2", name: "Nightly brain health", prefix: "ck_c21e", scopes: ["read"], createdAt: "2026-10-28T15:00:00.000Z", expiresAt: "2027-01-28T15:00:00.000Z" },
];

export const SETTINGS_ROUTES: Record<string, unknown> = {
  "/api/keys": apiKeys,
  "/api/members": members,
  "/api/groups": groups,
  "/api/tags/org": { concepts: tags },
  "/api/rules": { rules: globalRules },
};
