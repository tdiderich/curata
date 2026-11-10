// Help videos: a short MP4 per route, opened from the Help button in the
// dock. The manifest lives at public/help/videos.json so adding or re-rendering
// a video never needs a code change.

/**
 * A button under the player. Every video gets the same docs-like pair: one
 * thing to hand your agent, one place to read more. Videos can't be copied
 * from, so anything shown on screen that a viewer needs lives here.
 */
export interface HelpAction {
  label: string;
  /**
   * copy-setup:    copy the connect-and-set-up prompt (see setupPrompt)
   * copy-page:     copy the current page for an agent (same as the dock action)
   * copy-prompt:   copy `prompt`, with {origin} and {slug} filled in
   * connect-agent: open the connect modal
   * link:          go to `href` (a docs page, usually /pages/<slug>)
   */
  kind: "copy-setup" | "copy-page" | "copy-prompt" | "connect-agent" | "link";
  href?: string;
  /** copy-prompt only. */
  prompt?: string;
}

export interface HelpVideo {
  id: string;
  title: string;
  src: string;
  poster?: string;
  /** Portrait 1080x1920 cut, played on phone-width screens (PHONE_QUERY). */
  mobileSrc?: string;
  mobilePoster?: string;
  /** One-line summary shown under the player. */
  blurb?: string;
  /** First is the primary button. */
  actions?: HelpAction[];
}

export interface HelpRoute {
  // Exact path, or a glob: "*" inside matches one segment ("/pages/*/settings"),
  // a trailing "*" matches the rest ("/pages/*"). First match wins, so list
  // specific routes before broad ones.
  match: string;
  video: string;
  /** Pulse the Help button when the user sits idle on this route. */
  nudge?: boolean;
}

export interface HelpManifest {
  /** Video id used for first-visit welcome and for routes with no match. */
  welcome: string;
  videos: HelpVideo[];
  routes: HelpRoute[];
}

export function matchRoute(pathname: string, routes: HelpRoute[]): HelpRoute | null {
  for (const r of routes) {
    if (!r.match.includes("*")) {
      if (pathname === r.match) return r;
      continue;
    }
    const trailing = r.match.endsWith("*");
    const body = trailing ? r.match.slice(0, -1) : r.match;
    const re = body.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]+");
    if (new RegExp(`^${re}${trailing ? ".*" : ""}$`).test(pathname)) return r;
  }
  return null;
}

/** Fill {origin} and {slug} in a copy-prompt action. */
export function fillPrompt(prompt: string, vars: { origin: string; slug: string | null }): string {
  return prompt.replaceAll("{origin}", vars.origin).replaceAll("{slug}", vars.slug ?? "this page");
}

/** The video for a route, falling back to the welcome video. */
export function resolveHelpVideo(pathname: string, manifest: HelpManifest): HelpVideo | null {
  const route = matchRoute(pathname, manifest.routes);
  const id = route?.video ?? manifest.welcome;
  return manifest.videos.find((v) => v.id === id) ?? manifest.videos.find((v) => v.id === manifest.welcome) ?? null;
}

/** Screens that get a video's portrait cut. Matches the app's mobile dock breakpoint. */
export const PHONE_QUERY = "(max-width: 640px)";

// Nudge rules: idle pulses are easy to make annoying, so they are capped.
export const NUDGE_IDLE_MS = 30_000;
export const NUDGE_MAX_SESSIONS = 3;
export const NUDGE_MAX_DISMISSALS = 2;

export interface NudgeState {
  sessions: number;
  dismissals: number;
  /** Paths already nudged this session. */
  nudgedPaths: string[];
}

export function shouldNudge(pathname: string, manifest: HelpManifest, state: NudgeState): boolean {
  const route = matchRoute(pathname, manifest.routes);
  if (!route?.nudge) return false;
  if (state.sessions > NUDGE_MAX_SESSIONS) return false;
  if (state.dismissals >= NUDGE_MAX_DISMISSALS) return false;
  return !state.nudgedPaths.includes(pathname);
}
