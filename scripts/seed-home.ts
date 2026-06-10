// Seeds the reserved `home` page for local verification of the at-a-glance
// dashboard. In production this page is written by agents via MCP write_page
// as the final step of TS Hub workflows. To make local review realistic, the
// content is generated from the live workspace: recent pages, pending
// annotations, and plan/workflow pages — the same material a real refresh
// step would survey.
import { db } from "../src/lib/db";
import { writePage } from "../src/lib/pages";

function relTime(d: Date): string {
  const hours = (Date.now() - d.getTime()) / 36e5;
  if (hours < 1) return "just now";
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function mdEscape(s: string): string {
  return s.replace(/[[\]]/g, "");
}

async function main() {
  const org = await db.organization.findFirst({ select: { id: true, slug: true } });
  if (!org) throw new Error("No organization found — run the app once to seed an org.");

  const recent = await db.page.findMany({
    where: { orgId: org.id, slug: { not: "home" }, status: { not: "archived" } },
    orderBy: { updatedAt: "desc" },
    take: 6,
    select: { slug: true, title: true, updatedAt: true },
  });

  const pendingAnnotations = await db.annotation.findMany({
    where: { page: { orgId: org.id }, status: "pending" },
    take: 4,
    select: { text: true, page: { select: { slug: true, title: true } } },
  });

  const planPages = await db.page.findMany({
    where: {
      orgId: org.id,
      status: { not: "archived" },
      OR: [
        { folder: { name: { contains: "plan", mode: "insensitive" } } },
        { folder: { name: { contains: "workflow", mode: "insensitive" } } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: 3,
    select: { slug: true, title: true },
  });

  const recentBullets = recent
    .map((p) => `- Updated [${mdEscape(p.title)}](${p.slug}) — ${relTime(p.updatedAt)}`)
    .join("\n");

  const attentionBullets = pendingAnnotations.length
    ? pendingAnnotations
        .map((a) => `- [${mdEscape(a.page.title)}](${a.page.slug}) — open annotation: "${mdEscape(a.text).slice(0, 80)}"`)
        .join("\n")
    : "- Nothing flagged — no pending annotations across the workspace.";

  const planBullets = planPages.length
    ? planPages.map((p) => `- [${mdEscape(p.title)}](${p.slug}) — active`).join("\n")
    : "- No plan pages found yet.";

  const indent = (s: string) => s.split("\n").map((l) => `          ${l}`).join("\n");

  const HOME_YAML = `title: Curata at a glance
shell: standard
components:
  - type: section
    heading: What this workspace is
    components:
      - type: markdown
        body: |
          This workspace is the system of record for Technical Success customer work.
          Pages are written and maintained by AI agents via MCP; folders group
          customers, plans, blueprints, and pre-sales work. Humans read, annotate,
          and spot-check.
  - type: section
    heading: What happened recently
    components:
      - type: markdown
        body: |
${indent(recentBullets)}
  - type: section
    heading: Needs attention
    components:
      - type: markdown
        body: |
${indent(attentionBullets)}
  - type: section
    heading: Plans in motion
    components:
      - type: markdown
        body: |
${indent(planBullets)}
`;

  const result = await writePage(org.id, org.slug, "home", HOME_YAML, "seed-script");
  if (!result.ok) throw new Error(`writePage failed: ${result.error}`);
  console.log(`Seeded home page for org ${org.slug} from live workspace data:`);
  console.log(`  ${recent.length} recent pages, ${pendingAnnotations.length} pending annotations, ${planPages.length} plan pages`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
