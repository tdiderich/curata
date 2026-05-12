import yaml from "js-yaml";
import { createHash } from "crypto";
import { db } from "./db";
import type { Prisma } from "@/generated/prisma/client";

const GETTING_STARTED_SLUG = "getting-started";

const GETTING_STARTED_PAGE = {
  title: "Getting Started with Curata",
  shell: "standard",
  subtitle: "Your AI-native knowledge base — personalized for your team",
  components: [
    {
      type: "header",
      title: "Getting Started with Curata",
      subtitle: "Connect an agent to personalize this page for your company",
    },
    {
      type: "markdown",
      body: "This page is a starting point. Connect an AI agent and ask it to **update this page based on what it knows about your company** — it will replace the generic content below with specifics about your team, your tools, and your workflows.",
    },
    {
      type: "divider",
      label: "The Problem",
    },
    {
      type: "section",
      heading: "Knowledge breaks down as you grow",
      components: [
        {
          type: "card_grid",
          cards: [
            {
              title: "Scattered context",
              description: "Decisions live in Slack threads, meeting notes, email chains, and CRM fields. Nobody has the full picture.",
            },
            {
              title: "Stale docs",
              description: "Wiki pages go out of date the day they're written. Nobody owns the refresh cycle.",
            },
            {
              title: "Manual reporting",
              description: "Someone spends hours pulling data from 5 tools to build a status update that's outdated by the time it's shared.",
            },
            {
              title: "Tribal knowledge",
              description: "Critical context lives in people's heads. When they're out or leave, it leaves with them.",
            },
          ],
        },
      ],
    },
    {
      type: "divider",
      label: "How Curata Works",
    },
    {
      type: "section",
      heading: "Three steps to a living knowledge base",
      components: [
        {
          type: "steps",
          numbered: true,
          items: [
            {
              title: "Connect your agent",
              detail: "Generate an API key and paste the agent prompt into Claude, ChatGPT, or any AI tool. The agent gets read/write access to your knowledge base via a simple REST API.",
            },
            {
              title: "Agent builds and updates pages",
              detail: "Your agent pulls from your connected tools — CRM, email, Slack, calendar, ticketing — and writes structured pages with real data. No manual copy-paste.",
            },
            {
              title: "Team reviews and annotates",
              detail: "Your team reviews agent-written pages in the browser. Add annotations for corrections, approve changes, or flag gaps. The agent incorporates feedback on its next pass.",
            },
          ],
        },
      ],
    },
    {
      type: "divider",
      label: "Use Cases",
    },
    {
      type: "section",
      heading: "How your team will use Curata",
      eyebrow: "Ask your agent to fill these in",
      components: [
        {
          type: "card_grid",
          cards: [
            {
              title: "Sales & GTM",
              description: "Deal reviews, account briefs, competitive intel, pipeline snapshots — always current, built from CRM + call data.",
            },
            {
              title: "Engineering",
              description: "Architecture docs, incident postmortems, sprint summaries, on-call runbooks — kept in sync with Linear/Jira and code changes.",
            },
            {
              title: "Product",
              description: "Feature specs, customer feedback digests, launch checklists, roadmap status — one source of truth across tools.",
            },
            {
              title: "People & HR",
              description: "Org charts, onboarding guides, team directories, policy docs — auto-updated as the company evolves.",
            },
            {
              title: "Operations",
              description: "Vendor trackers, process docs, compliance checklists, budget summaries — structured and auditable.",
            },
          ],
        },
      ],
    },
    {
      type: "divider",
      label: "Your Company",
    },
    {
      type: "section",
      heading: "How [Your Company] will use Curata",
      eyebrow: "Agent-personalized section",
      components: [
        {
          type: "callout",
          variant: "info",
          title: "This section is for your agent to fill in",
          body: "Once you connect an agent, ask it: \"Update this page with everything you think I'd use Curata for based on what you know about me.\" The agent will replace this callout with specifics about your company, your tools, and your team's workflows.",
        },
      ],
    },
    {
      type: "divider",
      label: "Pricing",
    },
    {
      type: "section",
      heading: "Simple pricing that scales with you",
      components: [
        {
          type: "stat_grid",
          columns: 3,
          stats: [
            { label: "Starter", value: "Free", detail: "5 pages, 1 agent, community support" },
            { label: "Team", value: "$49/mo", detail: "Unlimited pages, 5 agents, priority support" },
            { label: "Enterprise", value: "Custom", detail: "SSO, audit logs, dedicated support, SLA" },
          ],
        },
      ],
    },
    {
      type: "divider",
    },
    {
      type: "callout",
      variant: "success",
      title: "Ready to get started?",
      body: "Connect an agent using the button above, or create pages manually from the dashboard. Your agent can personalize this entire page in under a minute.",
    },
  ],
};

export async function seedGettingStartedPage(orgId: string, createdBy: string): Promise<void> {
  const existing = await db.page.findUnique({
    where: { orgId_slug: { orgId, slug: GETTING_STARTED_SLUG } },
  });
  if (existing) return;

  const yamlContent = yaml.dump(GETTING_STARTED_PAGE, { lineWidth: -1, noRefs: true });
  const contentHash = createHash("sha256").update(yamlContent).digest("hex");

  await db.page.create({
    data: {
      orgId,
      slug: GETTING_STARTED_SLUG,
      title: GETTING_STARTED_PAGE.title,
      createdBy,
      versions: {
        create: {
          yamlContent,
          jsonContent: GETTING_STARTED_PAGE as unknown as Prisma.InputJsonValue,
          contentHash,
          createdBy,
        },
      },
      annotations: {
        create: [
          {
            text: "This is an annotation. Your team and agents leave these on pages to suggest changes, flag issues, or add context. Try clicking Approve or Ignore below.",
            author: "curata",
            section: "Knowledge breaks down as you grow",
            target: "Scattered context",
            kind: "note",
            status: "pending",
            source: "agent",
          },
          {
            text: "Annotations can also be edits — specific text replacements an agent suggests. Approve to accept, ignore to dismiss.",
            author: "curata",
            section: "How your team will use Curata",
            target: "Deal reviews, account briefs, competitive intel, pipeline snapshots",
            kind: "edit",
            replacement: "Deal reviews, account briefs, competitive intel, pipeline snapshots — always current, pulled from your CRM and call recordings",
            status: "pending",
            source: "agent",
          },
          {
            text: "Approved annotations stay visible so you can review what was accepted. Your agent will incorporate approved edits on its next update pass.",
            author: "curata",
            kind: "note",
            status: "approved",
            source: "agent",
          },
        ],
      },
    },
  });
}
