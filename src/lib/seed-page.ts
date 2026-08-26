import yaml from "js-yaml";
import { createHash } from "crypto";
import { db } from "./db";
import type { Prisma } from "@/generated/prisma/client";

const GETTING_STARTED_SLUG = "getting-started";

const GETTING_STARTED_PAGE = {
  title: "Getting Started with Curata",
  shell: "standard",
  subtitle: "From empty brain to running loop in about 30 minutes.",
  components: [
    {
      type: "header",
      title: "Getting Started with Curata",
      subtitle: "Five steps, in order. Your agents do most of the work.",
    },
    {
      type: "markdown",
      body: "Curata is the company brain: agents and humans write validated knowledge into it, and everything learned flows back to both.",
    },
    {
      type: "divider",
      label: "Step 1",
    },
    {
      type: "section",
      heading: "Connect an agent",
      components: [
        {
          type: "markdown",
          body: "Add your curata instance as an MCP connector and sign in when the browser opens. OAuth handles the rest - no keys to copy for interactive use.",
        },
        {
          type: "code",
          language: "bash",
          code: "# Claude Code\nclaude mcp add --transport http curata https://curata.ai/api/mcp/stream\n\n# Claude.ai or ChatGPT: add a connector with this URL\nhttps://curata.ai/api/mcp/stream",
        },
        {
          type: "markdown",
          body: "Self-hosted? Swap in your instance URL. Headless agents and CI can still use an API key from **Settings → API Keys** on the same endpoint.",
        },
      ],
    },
    {
      type: "divider",
      label: "Step 2",
    },
    {
      type: "section",
      heading: "Ask before you write",
      components: [
        {
          type: "markdown",
          body: "Prove the read path with one question:",
        },
        {
          type: "code",
          language: "text",
          code: "> Search curata for \"how do skills work\"",
        },
        {
          type: "markdown",
          body: "The answer comes from pages already in this brain. Search first, answer from approved pages.",
        },
      ],
    },
    {
      type: "divider",
      label: "Step 3",
    },
    {
      type: "section",
      heading: "Capture your first page",
      components: [
        {
          type: "markdown",
          body: "Tell your agent something your team knows that isn't written anywhere, and ask it to save it:",
        },
        {
          type: "code",
          language: "text",
          code: "> Our staging deploys freeze every Friday at noon. Save that to curata so\n> other agents stop suggesting Friday releases.",
        },
        {
          type: "markdown",
          body: "The page lands in your workspace, validated against your org's rules. From now on every connected agent knows it.",
        },
      ],
    },
    {
      type: "divider",
      label: "Step 4",
    },
    {
      type: "section",
      heading: "Run your first skill",
      components: [
        {
          type: "markdown",
          body: "Open **Skill - FAQ Capture** in the Skills folder and ask your agent to run it. It scans your help channels for questions asked more than once and proposes one approved FAQ page per question. Run it once now, then schedule a weekly sweep.",
        },
        {
          type: "callout",
          variant: "info",
          title: "No chat tool connected yet?",
          body: "Skip this for now. Step 3 already proved capture works. Come back once Slack or Teams is connected via MCP.",
        },
      ],
    },
    {
      type: "divider",
      label: "Step 5",
    },
    {
      type: "section",
      heading: "Invite your team",
      components: [
        {
          type: "markdown",
          body: "Invite one teammate from **Settings → Members**. The brain is multiplayer by default: every agent and every human works off the same validated pages, and one person's capture becomes everyone's context.",
        },
      ],
    },
    {
      type: "divider",
      label: "What's already here",
    },
    {
      type: "section",
      heading: "Your brain ships stocked",
      components: [
        {
          type: "card_grid",
          cards: [
            {
              title: "Getting Started",
              description: "Product docs: connecting agents, the MCP tools reference, page structure, and architecture. Self-hosting lives in the OSS README on GitHub.",
            },
            {
              title: "Skills",
              description: "Validated agent procedures: call prep, deal review, FAQ capture, weekly highlights, and more. Copy and adapt.",
            },
            {
              title: "Templates",
              description: "Page structures agents fill through create_from_template: plans, proposals, FAQs, deployment status.",
            },
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
      title: "Make it yours",
      body: "Ask your agent: \"Update this page based on what you know about my company.\" It will swap the generic examples for your tools, your channels, and your workflows.",
    },
  ],
};

export async function seedGettingStartedPage(orgId: string, createdBy: string, folderId?: string): Promise<void> {
  const existing = await db.page.findUnique({
    where: { orgId_slug: { orgId, slug: GETTING_STARTED_SLUG } },
  });
  if (existing) {
    // Backfill: adopt a pre-existing loose getting-started page into the
    // Getting Started folder without touching its content.
    if (folderId && !existing.folderId) {
      await db.page.update({ where: { id: existing.id }, data: { folderId, seeded: true } });
    } else if (!existing.seeded) {
      await db.page.update({ where: { id: existing.id }, data: { seeded: true } });
    }
    return;
  }

  const yamlContent = yaml.dump(GETTING_STARTED_PAGE, { lineWidth: -1, noRefs: true });
  const contentHash = createHash("sha256").update(yamlContent).digest("hex");

  await db.page.create({
    data: {
      orgId,
      slug: GETTING_STARTED_SLUG,
      title: GETTING_STARTED_PAGE.title,
      folderId,
      createdBy,
      seeded: true,
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
            section: "Capture your first page",
            target: "validated against your org's rules",
            kind: "note",
            status: "pending",
            source: "agent",
          },
          {
            text: "Annotations can also be edits: specific text replacements an agent suggests. Approve to accept, ignore to dismiss.",
            author: "curata",
            section: "Run your first skill",
            target: "Run it once now, then schedule a weekly sweep.",
            kind: "edit",
            replacement: "Run it once now, then schedule a weekly sweep for Monday mornings.",
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
