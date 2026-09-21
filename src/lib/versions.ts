import { db } from "./db";

export interface VersionRead {
  slug: string;
  versionId: string;
  contentHash: string;
  createdBy: string;
  createdAt: string;
  /** Position in the page's history, 1 = oldest. */
  index: number;
  total: number;
  yaml: string;
  /** Present when compare_to was given: the line diff from that version to this one. */
  diff?: { from: string; added: string[]; removed: string[]; unchanged: number };
}

/** Plain line diff (LCS), enough to answer "what changed" between two versions. */
export function lineDiff(from: string, to: string): { added: string[]; removed: string[]; unchanged: number } {
  const a = from.split("\n"), b = to.split("\n");
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const added: string[] = [], removed: string[] = [];
  let i = 0, j = 0, same = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { same++; i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) removed.push(a[i++]);
    else added.push(b[j++]);
  }
  while (i < n) removed.push(a[i++]);
  while (j < m) added.push(b[j++]);
  return { added, removed, unchanged: same };
}

/**
 * Read one past version of a page, the way the versions UI does. With
 * compareTo, also the line diff from that version to this one, so an agent
 * can answer "what changed" instead of inferring it from two hashes.
 * version "previous" reads the one before the latest.
 */
export async function readVersion(orgId: string, slug: string, versionId: string, compareTo?: string): Promise<VersionRead> {
  const page = await db.page.findUnique({
    where: { orgId_slug: { orgId, slug } },
    select: { id: true, versions: { orderBy: { createdAt: "asc" }, select: { id: true, contentHash: true, createdBy: true, createdAt: true, yamlContent: true } } },
  });
  if (!page) throw new Error(`page not found: ${slug}`);
  const vs = page.versions;
  const pick = (ref: string) => {
    if (ref === "latest") return vs[vs.length - 1];
    if (ref === "previous") return vs[vs.length - 2];
    return vs.find((v) => v.id === ref);
  };
  const v = pick(versionId);
  if (!v) throw new Error(`version not found: ${versionId}. get_versions ${slug} lists ids; "latest" and "previous" also work.`);
  const out: VersionRead = {
    slug, versionId: v.id, contentHash: v.contentHash, createdBy: v.createdBy, createdAt: v.createdAt.toISOString(),
    index: vs.indexOf(v) + 1, total: vs.length, yaml: v.yamlContent,
  };
  if (compareTo) {
    const base = pick(compareTo);
    if (!base) throw new Error(`version not found: ${compareTo}`);
    out.diff = { from: base.id, ...lineDiff(base.yamlContent, v.yamlContent) };
  }
  return out;
}
