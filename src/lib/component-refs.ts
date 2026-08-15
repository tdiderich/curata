import { resolvePageAccess } from "./access";
import { readPage } from "./pages";
import type { Channel } from "./pages";

// Shared components: a `type: ref` block embeds another page's `components`
// array by reference. Expansion happens here, at read time, and only here —
// every render/read/export path (pages/[slug], the public /p/ route,
// export-preview, and MCP read_page) funnels through expandComponentRefs
// before the tree reaches the renderer, so stored docs never contain
// expanded content and the renderer never has to know `ref` exists.

export const MAX_REF_DEPTH = 3;

type Comp = Record<string, unknown>;

export interface RefViewer {
  /** Signed-in user id, or null for an anonymous/public viewer. */
  userId: string | null;
  /** Any org role string ("member", "owner"...), or null if this viewer isn't a member of the org. Only truthiness matters to resolvePageAccess. */
  orgMemberRole: string | null;
  /** Share-link token, when the surface being rendered carries one (public pages). */
  shareToken?: string;
}

export interface RefExpansionContext {
  orgId: string;
  channel: Channel;
  viewer: RefViewer;
  /**
   * Builds the component(s) that replace a resolved `ref` block, given the
   * source page's slug/title and its (already expanded + id-namespaced)
   * components. Callers control the attribution shape here: a subtle
   * markdown chip for rendered surfaces, a more explicit "edits go through
   * the source page" note for MCP's read_page.
   */
  wrap(slug: string, title: string, components: Comp[]): Comp[];
  /**
   * Builds the single placeholder component rendered in place of a `ref`
   * that could not be expanded (missing slug, cycle, depth overflow, missing
   * target, no access, or target isn't a component page). Never leaks the
   * target's content — only the slug and the reason.
   */
  placeholder(slug: string, reason: string): Comp;
}

interface RefBlock extends Comp {
  type: "ref";
}

// Narrows to RefBlock (not Comp) so the negative branch keeps `c` usable —
// a `c is Comp` predicate would collapse the else-branch type to `never`.
function isRefBlock(c: unknown): c is RefBlock {
  return !!c && typeof c === "object" && (c as Comp).type === "ref";
}

/** Prefixes every explicit `id` in a components tree with `prefix--` so an expanded subtree can never collide with ids already on the consuming page (or with another expansion of the same shared component elsewhere on the page). Mirrors the nested-array shapes component-ids.ts already knows about. */
function namespaceIds(components: Comp[], prefix: string): Comp[] {
  return components.map((c) => {
    if (!c || typeof c !== "object") return c;
    const next: Comp = { ...c };
    if (typeof next.id === "string" && next.id) next.id = `${prefix}--${next.id}`;
    if (Array.isArray(next.components)) {
      next.components = namespaceIds(next.components as Comp[], prefix);
    }
    if (Array.isArray(next.items)) {
      next.items = (next.items as Comp[]).map((item) =>
        item && typeof item === "object" && Array.isArray((item as Comp).components)
          ? { ...item, components: namespaceIds((item as Comp).components as Comp[], prefix) }
          : item
      );
    }
    if (Array.isArray(next.tabs)) {
      next.tabs = (next.tabs as Comp[]).map((tab) =>
        tab && typeof tab === "object" && Array.isArray((tab as Comp).components)
          ? { ...tab, components: namespaceIds((tab as Comp).components as Comp[], prefix) }
          : tab
      );
    }
    if (Array.isArray(next.columns)) {
      next.columns = (next.columns as unknown[]).map((col) =>
        Array.isArray(col) ? namespaceIds(col as Comp[], prefix) : col
      );
    }
    return next;
  });
}

async function resolveRef(
  ref: Comp,
  ctx: RefExpansionContext,
  depth: number,
  chain: string[]
): Promise<Comp[]> {
  const slug = typeof ref.component === "string" ? ref.component.trim() : "";
  const refId = typeof ref.id === "string" && ref.id ? ref.id : `ref-${depth}`;

  if (!slug) {
    return [ctx.placeholder("(unknown)", "this ref block has no component slug set")];
  }
  if (chain.includes(slug)) {
    return [ctx.placeholder(slug, `cycle detected: ${[...chain, slug].join(" -> ")}`)];
  }
  const nextDepth = depth + 1;
  if (nextDepth > MAX_REF_DEPTH) {
    return [ctx.placeholder(slug, `expansion stopped at ${MAX_REF_DEPTH} levels deep — flatten the reference chain`)];
  }

  const resolved = await readPage(ctx.orgId, slug, ctx.channel);
  if (!resolved) {
    return [ctx.placeholder(slug, "page not found")];
  }

  const access = await resolvePageAccess(
    { id: resolved.pageId, orgId: ctx.orgId, slug, visibility: resolved.visibility, createdBy: resolved.createdBy },
    ctx.viewer.userId,
    ctx.viewer.orgMemberRole,
    ctx.viewer.shareToken
  );
  if (!access) {
    return [ctx.placeholder(slug, "you don't have access to this page")];
  }

  if (resolved.json.pageType !== "component") {
    return [ctx.placeholder(slug, `"${slug}" is not a component page (pageType must be "component")`)];
  }

  const inner = Array.isArray(resolved.json.components) ? (resolved.json.components as Comp[]) : [];
  const expandedInner = await expandComponentRefs(inner, ctx, depth + 1, [...chain, slug]);
  const namespaced = namespaceIds(expandedInner, refId);
  const title = (resolved.json.title as string) || slug;

  return ctx.wrap(slug, title, namespaced);
}

/**
 * Walks a components tree (including nested `components`/`items[].components`/
 * `tabs[].components`/`columns[]` arrays) and replaces every `type: ref`
 * block with its target component page's expanded content. Safe to call on
 * any page's components — pages with no refs pass through unchanged.
 */
export async function expandComponentRefs(
  components: Comp[] | undefined | null,
  ctx: RefExpansionContext,
  depth = 0,
  chain: string[] = []
): Promise<Comp[]> {
  if (!Array.isArray(components)) return [];

  const out: Comp[] = [];
  for (const c of components) {
    if (!c || typeof c !== "object") {
      out.push(c as Comp);
      continue;
    }
    if (isRefBlock(c)) {
      out.push(...(await resolveRef(c, ctx, depth, chain)));
      continue;
    }

    const next: Comp = { ...c };
    if (Array.isArray(next.components)) {
      next.components = await expandComponentRefs(next.components as Comp[], ctx, depth, chain);
    }
    if (Array.isArray(next.items)) {
      const items = next.items as Comp[];
      next.items = await Promise.all(
        items.map(async (item) =>
          item && typeof item === "object" && Array.isArray((item as Comp).components)
            ? { ...item, components: await expandComponentRefs((item as Comp).components as Comp[], ctx, depth, chain) }
            : item
        )
      );
    }
    if (Array.isArray(next.tabs)) {
      const tabs = next.tabs as Comp[];
      next.tabs = await Promise.all(
        tabs.map(async (tab) =>
          tab && typeof tab === "object" && Array.isArray((tab as Comp).components)
            ? { ...tab, components: await expandComponentRefs((tab as Comp).components as Comp[], ctx, depth, chain) }
            : tab
        )
      );
    }
    if (Array.isArray(next.columns)) {
      const columns = next.columns as unknown[];
      next.columns = await Promise.all(
        columns.map(async (col) => (Array.isArray(col) ? await expandComponentRefs(col as Comp[], ctx, depth, chain) : col))
      );
    }
    out.push(next);
  }
  return out;
}

/** Standard "subtle chip" attribution + error placeholder for rendered surfaces (app page view, public /p/ page, export preview): a small linked markdown note above the expanded content, and a low-key callout when expansion fails. Nothing else — no editor UI, no picker. */
export function renderedRefWrap(hrefFor: (slug: string) => string): Pick<RefExpansionContext, "wrap" | "placeholder"> {
  return {
    wrap: (slug, title, components) => [
      { type: "markdown", id: `shared-${slug}-attribution`, body: `*shared: [${title}](${hrefFor(slug)})*` },
      ...components,
    ],
    placeholder: (slug, reason) => ({
      type: "callout",
      id: `shared-${slug}-error`,
      variant: "warn",
      title: `Shared component unavailable: ${slug}`,
      body: reason,
    }),
  };
}

/** MCP read_page attribution: more explicit than the UI chip since the reader is an agent that might otherwise try to patch the expanded blocks in place — names the source slug and points edits at patch_page on that slug. */
export function agentRefWrap(): Pick<RefExpansionContext, "wrap" | "placeholder"> {
  return {
    wrap: (slug, title, components) => [
      {
        type: "markdown",
        id: `shared-${slug}-start`,
        body: `---\nShared component: "${title}" (source page \`${slug}\`). This content is expanded for reading only — to change it, call patch_page or write_page on \`${slug}\` directly. Edits made to these blocks on this page will not persist.\n---`,
      },
      ...components,
      {
        type: "markdown",
        id: `shared-${slug}-end`,
        body: `*(end of shared component "${slug}")*`,
      },
    ],
    placeholder: (slug, reason) => ({
      type: "callout",
      id: `shared-${slug}-error`,
      variant: "warn",
      title: `Shared component unavailable: ${slug}`,
      body: reason,
    }),
  };
}
