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

export interface GlanceContext {
  /** Origin of this curata instance, e.g. https://curata.example.com */
  origin?: string;
}

// Every copied prompt starts with this header so the receiving agent knows
// exactly which instance to talk to and which tools to reach for — no
// guessing, no "which curata?" follow-up.
function contextHeader(ctx: GlanceContext): string {
  const where = ctx.origin
    ? `Curata instance: ${ctx.origin} (MCP endpoint: ${ctx.origin}/api/mcp/stream).`
    : `Use my configured curata MCP server.`;
  return `${where} Tools: read_page (page content by slug), list_pages, search_pages, patch_page (targeted edits), write_page (full rewrite), annotate_page. Page references below are slugs — pass them to read_page; in the UI they live at ${ctx.origin ?? ""}/pages/<slug>.`;
}

const TEMPLATES: Template[] = [
  {
    match: /attention/i,
    build: (body) =>
      `These items in my curata workspace need attention:\n\n${body.trim()}\n\nFor each item (highest impact first): read the linked page with read_page, review the open annotation or issue, propose a fix, and apply it with patch_page after I approve. Resolve each annotation once handled.`,
    summarize: (items, pages) =>
      `Works through ${plural(items, "open item")} across ${plural(pages, "page")} — proposes a fix for each and applies it after your approval.`,
  },
  {
    match: /plans? in motion|plans?$/i,
    build: (body) =>
      `Read these active plan pages from my curata workspace:\n\n${body.trim()}\n\nFor each plan (read_page per slug), summarize: work completed, in flight, and remaining, plus any blockers. Then recommend what to tackle next and why.`,
    summarize: (items) =>
      `Reads ${plural(items, "active plan")} and reports completed, in-flight, and remaining work with blockers — then recommends what to tackle next.`,
  },
  {
    match: /recent/i,
    build: (body) =>
      `These pages in my curata workspace changed recently:\n\n${body.trim()}\n\nRead each with read_page and brief me: what changed, why it matters, and anything that needs follow-up from me.`,
    summarize: (items, pages) =>
      `Briefs you on ${plural(pages, "recently updated page")} — what changed, why it matters, and what needs follow-up.`,
  },
];

function genericTemplate(heading: string, body: string): string {
  return `From my curata workspace's at-a-glance home, section "${heading}":\n\n${body.trim()}\n\nRead the linked pages with read_page and take the appropriate next steps. Confirm with me before writing any changes.`;
}

export function isEmptySection(section: GlanceSection): boolean {
  return isEmptyState(bulletLines(section.body));
}

export function hasDashboardBlock(json: Record<string, unknown>): boolean {
  const d = json.dashboard;
  return (
    !!d &&
    typeof d === "object" &&
    !Array.isArray(d) &&
    typeof (d as Record<string, unknown>).prompt === "string"
  );
}

// Live DB-derived bodies for the three standard cards, computed on every
// dashboard load. The home page is a stash of orientation prose and custom
// prompts, not a report — standard cards are live by default.
export interface GlanceFallbacks {
  recently?: string;
  attention?: string;
  plans?: string;
}

// A home-page section with a matching heading overrides its live body only
// when an agent has written real content there (synthesis beats mechanics);
// missing or stub sections defer to the live body. Non-standard sections on
// the home page become extra cards after the standard three.
const STANDARD_CARDS: Array<{ heading: string; key: keyof GlanceFallbacks; match: RegExp }> = [
  { heading: "What happened recently", key: "recently", match: /recent/i },
  { heading: "Needs attention", key: "attention", match: /attention/i },
  { heading: "Plans in motion", key: "plans", match: /plans? in motion|plans?$/i },
];

export function buildGlanceSections(
  pageSections: GlanceSection[],
  fallbacks: GlanceFallbacks
): GlanceSection[] {
  const standard = STANDARD_CARDS.map(({ heading, key, match }) => {
    const fromPage = pageSections.find((s) => match.test(s.heading));
    if (fromPage && !isEmptySection(fromPage)) return fromPage;
    return { heading: fromPage?.heading ?? heading, body: fallbacks[key] ?? "", prompt: fromPage?.prompt };
  });
  const extras = pageSections.filter((s) => !STANDARD_CARDS.some((c) => c.match.test(s.heading)));
  return [...standard, ...extras];
}

// User-curated custom prompt cards: a top-level `prompts:` block in the home
// page YAML. Not generated, not global — each instance/user adds their own
// (e.g. "Draft the customer chronicle"). Workflow refreshes must preserve
// the block (see the home page contract).
export function extractCustomPrompts(json: Record<string, unknown>, ctx: GlanceContext = {}): GlanceCard[] {
  const raw = json.prompts;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (p): p is { title: string; prompt: string; description?: string } =>
        !!p && typeof p === "object" && typeof (p as Record<string, unknown>).title === "string" &&
        typeof (p as Record<string, unknown>).prompt === "string"
    )
    .map((p) => ({
      title: p.title,
      subtitle: "custom",
      summary: typeof p.description === "string" ? p.description : "Custom prompt for this workspace.",
      prompt: `${contextHeader(ctx)}\n\n${p.prompt.trim()}`,
    }));
}

export function buildGlanceCard(section: GlanceSection, ctx: GlanceContext = {}): GlanceCard {
  const items = bulletLines(section.body);
  const empty = isEmptyState(items);
  const template = TEMPLATES.find((t) => t.match.test(section.heading));
  const pages = Math.max(distinctPageCount(section.body), 1);

  const action = empty
    ? ""
    : section.prompt ?? (template?.build(section.body) ?? genericTemplate(section.heading, section.body));
  const prompt = action ? `${contextHeader(ctx)}\n\n${action}` : "";

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

export interface StalePageInfo {
  slug: string;
  title: string;
  staleness: "due" | "overdue";
  reason: string | null;
}

export function buildStaleCard(pages: StalePageInfo[], ctx: GlanceContext = {}): GlanceCard {
  if (pages.length === 0) {
    return { title: "Stale page audit", subtitle: "all clear", summary: "No stale pages to review.", prompt: "" };
  }
  const body = pages
    .map((p) => `- [${p.title}](${p.slug}) — ${p.staleness}${p.reason ? ` (${p.reason})` : ""}`)
    .join("\n");
  const prompt = `${contextHeader(ctx)}\n\nThese pages are past their review date:\n\n${body}\n\nRead each with read_page, check accuracy against current state, flag what's outdated, update or archive.`;
  return {
    title: "Stale page audit",
    subtitle: `${pages.length} overdue`,
    summary: `Reviews ${plural(pages.length, "stale page")} for accuracy — flags what's outdated and proposes updates or archival.`,
    prompt,
  };
}

export interface FlagInfo {
  slug: string;
  title: string;
  action: string;
  confidence: string;
  reason: string;
}

export function buildFlagCard(flags: FlagInfo[], ctx: GlanceContext = {}): GlanceCard {
  if (flags.length === 0) {
    return { title: "Open flags", subtitle: "all clear", summary: "No open flags.", prompt: "" };
  }
  const body = flags
    .map((f) => `- [${f.title}](${f.slug}) — flag: "${f.action}" (confidence: ${f.confidence}) — "${f.reason}"`)
    .join("\n");
  const prompt = `${contextHeader(ctx)}\n\nThese pages have been flagged:\n\n${body}\n\nReview each flag with read_page. Triage by confidence, take the flagged action (archive/merge/update), resolve each flag.`;
  return {
    title: "Open flags",
    subtitle: plural(flags.length, "flag"),
    summary: `Reviews ${plural(flags.length, "flagged page")} — triages by confidence and resolves each flag.`,
    prompt,
  };
}

export interface RecentPageInfo {
  slug: string;
  title: string;
  folderName: string | null;
  updatedAt: Date;
}

export function buildRecentlyCard(
  pages: RecentPageInfo[],
  windowLabel: string,
  ctx: GlanceContext = {}
): GlanceCard {
  if (pages.length === 0) {
    return { title: "What happened recently", subtitle: "all clear", summary: "No recent changes.", prompt: "" };
  }

  const FOLDER_THRESHOLD = 10;

  if (pages.length > FOLDER_THRESHOLD) {
    const byFolder = new Map<string, RecentPageInfo[]>();
    for (const p of pages) {
      const key = p.folderName ?? "Uncategorized";
      const arr = byFolder.get(key) ?? [];
      arr.push(p);
      byFolder.set(key, arr);
    }
    const sorted = [...byFolder.entries()].sort((a, b) => b[1].length - a[1].length);
    const folderSummary = sorted.map(([name, items]) => `${name} (${items.length})`).join(", ");
    const folderDetail = sorted
      .map(([name, items]) => {
        const slugs = items.map((p) => `[${p.title}](${p.slug})`).join(", ");
        return `- **${name}** (${items.length}): ${slugs}`;
      })
      .join("\n");
    const prompt = `${contextHeader(ctx)}\n\n${pages.length} pages changed ${windowLabel} across ${folderSummary}.\n\n${folderDetail}\n\nSummarize what moved in each folder, starting with the busiest. For key changes, read_page to get details.`;
    return {
      title: "What happened recently",
      subtitle: `${pages.length} pages · ${byFolder.size} folders`,
      summary: `${pages.length} pages changed ${windowLabel} across ${byFolder.size} folders — summarizes what moved in each.`,
      prompt,
    };
  }

  const body = pages
    .map((p) => `- [${p.title}](${p.slug})`)
    .join("\n");
  const prompt = `${contextHeader(ctx)}\n\nThese pages changed recently:\n\n${body}\n\nRead each with read_page and brief me: what changed, why it matters, and anything that needs follow-up from me.`;
  return {
    title: "What happened recently",
    subtitle: `${pages.length} page${pages.length === 1 ? "" : "s"} ${windowLabel}`,
    summary: `Briefs you on ${plural(pages.length, "recently updated page")} — what changed, why it matters, and what needs follow-up.`,
    prompt,
  };
}

export interface DashboardBlock {
  prompt: string;
  title?: string;
  description?: string;
}

export interface DashboardPageInfo {
  title: string;
  subtitle: string | null;
  folderName: string | null;
  dashboard: DashboardBlock;
}

export function buildPageOptedCards(pages: DashboardPageInfo[], ctx: GlanceContext = {}): GlanceCard[] {
  return pages
    .sort((a, b) => {
      const fa = a.folderName ?? "";
      const fb = b.folderName ?? "";
      if (fa !== fb) return fa.localeCompare(fb);
      const ta = a.dashboard.title ?? a.title;
      const tb = b.dashboard.title ?? b.title;
      return ta.localeCompare(tb);
    })
    .map((p) => ({
      title: p.dashboard.title ?? p.title,
      subtitle: p.folderName ?? "custom",
      summary: p.dashboard.description ?? p.subtitle ?? p.title,
      prompt: `${contextHeader(ctx)}\n\n${p.dashboard.prompt.trim()}`,
    }));
}
