// Seeds the reserved `home` page for local verification of the at-a-glance
// dashboard. In production this page is written by agents via MCP write_page
// as the final step of TS Hub workflows.
import { db } from "../src/lib/db";
import { writePage } from "../src/lib/pages";

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
          - Seeded the at-a-glance home page ([home](home))
  - type: section
    heading: Needs attention
    components:
      - type: markdown
        body: |
          - Nothing flagged yet — agents will rank items here with a one-line why.
  - type: section
    heading: Plans in motion
    components:
      - type: markdown
        body: |
          - Curata at a Glance phase 1 — in progress
  - type: section
    heading: Open questions
    components:
      - type: markdown
        body: |
          - None carried forward yet.
`;

async function main() {
  const org = await db.organization.findFirst({ select: { id: true, slug: true } });
  if (!org) throw new Error("No organization found — run the app once to seed an org.");
  const result = await writePage(org.id, org.slug, "home", HOME_YAML, "seed-script");
  if (!result.ok) throw new Error(`writePage failed: ${result.error}`);
  console.log(`Seeded home page for org ${org.slug} (hash ${result.contentHash})`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
