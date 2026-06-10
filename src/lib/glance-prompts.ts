// Turns at-a-glance home sections into copyable action prompts. The glance is
// a launcher: each section becomes a card whose click copies a context-loaded
// prompt for an agent session, embedding the section's bullets (slugs intact)
// so the agent skips the survey step.

export interface GlanceSection {
  heading: string;
  body: string;
  prompt?: string;
}

export interface GlanceCard {
  title: string;
  subtitle: string;
  /** One sentence describing what the copied prompt will do. */
  summary: string;
  prompt: string;
}

interface RawComponent {
  type: string;
  heading?: string;
  prompt?: string;
  body?: string;
  components?: RawComponent[];
  [key: string]: unknown;
}

export function extractGlanceSections(components: RawComponent[]): GlanceSection[] {
  return components
    .filter((c) => c.type === "section" && typeof c.heading === "string")
    .map((c) => ({
      heading: c.heading as string,
      body: (c.components ?? [])
        .filter((k) => k.type === "markdown" && typeof k.body === "string")
        .map((k) => k.body as string)
        .join("\n"),
      prompt: typeof c.prompt === "string" ? c.prompt : undefined,
    }));
}

const EMPTY_MARKERS = [/^- nothing/i, /^- none/i, /^- no /i];

function bulletLines(body: string): string[] {
  return body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "));
}

function isEmptyState(items: string[]): boolean {
  return items.length === 0 || (items.length === 1 && EMPTY_MARKERS.some((re) => re.test(items[0])));
}

function distinctPageCount(body: string): number {
  return new Set([...body.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1])).size;
}

interface Template {
  match: RegExp;
  build: (body: string) => string;
  summarize: (items: number, pages: number) => string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const TEMPLATES: Template[] = [
  {
    match: /attention/i,
    build: (body) =>
      `These items in my curata workspace need attention:\n\n${body.trim()}\n\nFor each item (highest impact first): read the linked page via the curata MCP tools, review the open annotation or issue, propose a fix, and apply it with patch_page after I approve. Resolve each annotation once handled.`,
    summarize: (items, pages) =>
      `Works through ${plural(items, "open item")} across ${plural(pages, "page")} — proposes a fix for each and applies it after your approval.`,
  },
  {
    match: /plans? in motion|plans?$/i,
    build: (body) =>
      `Read these active plan pages from my curata workspace via the curata MCP tools:\n\n${body.trim()}\n\nFor each plan, summarize: work completed, in flight, and remaining, plus any blockers. Then recommend what to tackle next and why.`,
    summarize: (items) =>
      `Reads ${plural(items, "active plan")} and reports completed, in-flight, and remaining work with blockers — then recommends what to tackle next.`,
  },
  {
    match: /recent/i,
    build: (body) =>
      `These pages in my curata workspace changed recently:\n\n${body.trim()}\n\nRead them via the curata MCP tools and brief me: what changed, why it matters, and anything that needs follow-up from me.`,
    summarize: (items, pages) =>
      `Briefs you on ${plural(pages, "recently updated page")} — what changed, why it matters, and what needs follow-up.`,
  },
];

function genericTemplate(heading: string, body: string): string {
  return `From my curata workspace's at-a-glance home, section "${heading}":\n\n${body.trim()}\n\nRead the linked pages via the curata MCP tools and take the appropriate next steps. Confirm with me before writing any changes.`;
}

export function buildGlanceCard(section: GlanceSection): GlanceCard {
  const items = bulletLines(section.body);
  const empty = isEmptyState(items);
  const template = TEMPLATES.find((t) => t.match.test(section.heading));
  const pages = Math.max(distinctPageCount(section.body), 1);

  const prompt = empty
    ? ""
    : section.prompt ?? (template?.build(section.body) ?? genericTemplate(section.heading, section.body));

  const summary = empty
    ? "Nothing here right now."
    : template?.summarize(items.length, pages) ??
      `Reads ${plural(pages, "linked page")} and takes the next steps, confirming with you before writing.`;

  return {
    title: section.heading,
    subtitle: empty ? "all clear" : `${items.length} item${items.length === 1 ? "" : "s"}`,
    summary,
    prompt,
  };
}
