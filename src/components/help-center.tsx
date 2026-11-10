"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { basePath } from "@/lib/api-fetch";
import { trackClient } from "@/lib/analytics-client";
import {
  NUDGE_IDLE_MS,
  PHONE_QUERY,
  fillPrompt,
  resolveHelpVideo,
  shouldNudge,
  type HelpAction,
  type HelpManifest,
  type HelpVideo,
  type NudgeState,
} from "@/lib/help-videos";
import AgentConnectModal from "./agent-connect-modal";
import { toast } from "./toast";
import { copyPagesForAgent } from "@/lib/copy-for-agent";
import { setupPrompt } from "@/lib/starter-prompt";

/**
 * Help center: the per-route instructional video player, opened from the Help
 * button in the page dock (or a standalone Help button on routes with no
 * dock). Also runs the idle nudge that pulses the Help button.
 *
 * Other components talk to it through window events so the dock and the
 * dashboard don't need a shared React context:
 *   curata-help-open   open the player (detail: { videoId?, source })
 *   curata-help-nudge  (emitted) detail: boolean, Help button should pulse
 */

const OPEN_EVENT = "curata-help-open";
const NUDGE_EVENT = "curata-help-nudge";
const DOCK_EVENT = "curata-dock-change";

const LS_NUDGE = "curata:help-nudge";
const SS_SESSION = "curata:help-session";
const SS_NUDGED = "curata:help-nudged";
const NUDGE_SHOW_MS = 20_000;

let dockCount = 0;
let nudging = false;

/** The dock calls this on mount so the help center can skip its own button. */
export function registerDock(): () => void {
  dockCount += 1;
  window.dispatchEvent(new Event(DOCK_EVENT));
  return () => {
    dockCount -= 1;
    window.dispatchEvent(new Event(DOCK_EVENT));
  };
}

export function openHelp(source: string, videoId?: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { source, videoId } }));
}

function safeGet(store: Storage, key: string): string | null {
  try { return store.getItem(key); } catch { return null; }
}
function safeSet(store: Storage, key: string, value: string): void {
  try { store.setItem(key, value); } catch { /* storage blocked */ }
}

function readNudgeState(): NudgeState {
  let persisted = { sessions: 0, dismissals: 0 };
  try {
    persisted = { ...persisted, ...JSON.parse(safeGet(localStorage, LS_NUDGE) ?? "{}") };
  } catch { /* corrupt value: start over */ }
  let nudgedPaths: string[] = [];
  try {
    nudgedPaths = JSON.parse(safeGet(sessionStorage, SS_NUDGED) ?? "[]");
  } catch { /* ignore */ }
  return { ...persisted, nudgedPaths };
}

function writeNudgeState(s: NudgeState): void {
  safeSet(localStorage, LS_NUDGE, JSON.stringify({ sessions: s.sessions, dismissals: s.dismissals }));
  safeSet(sessionStorage, SS_NUDGED, JSON.stringify(s.nudgedPaths));
}

function HelpIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.2a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6" />
      <path d="M12 17h.01" />
    </svg>
  );
}

/** Help button with the dock's styling. Pulses while the idle nudge is on. */
export function HelpButton({ expanded, source = "dock" }: { expanded?: boolean; source?: string }) {
  const [pulse, setPulse] = useState(nudging);
  useEffect(() => {
    const on = (e: Event) => setPulse((e as CustomEvent<boolean>).detail);
    window.addEventListener(NUDGE_EVENT, on);
    return () => window.removeEventListener(NUDGE_EVENT, on);
  }, []);
  return (
    <button
      type="button"
      className={`dock-btn dock-btn--help${pulse ? " dock-btn--nudge" : ""}`}
      onClick={() => openHelp(source)}
      aria-label="Help: watch a quick video"
    >
      <span className="dock-btn-icon"><HelpIcon /></span>
      {expanded
        ? <span className="dock-btn-label">Help</span>
        : <span className="dock-tooltip" role="presentation">Help</span>}
    </button>
  );
}

/** Mounted by the dashboard for a brand-new org: opens the welcome video once. */
export function WelcomeAutoOpen() {
  useEffect(() => {
    const key = "curata:help-welcome-seen";
    if (safeGet(localStorage, key)) return;
    safeSet(localStorage, key, "1");
    // Let the help center mount and load its manifest first.
    const t = setTimeout(() => openHelp("first-visit", "welcome"), 400);
    return () => clearTimeout(t);
  }, []);
  return null;
}

export function HelpCenter({ authMode }: { authMode?: string }) {
  const pathname = usePathname() ?? "/";
  const [manifest, setManifest] = useState<HelpManifest | null>(null);
  const [video, setVideo] = useState<HelpVideo | null>(null);
  const [source, setSource] = useState("dock");
  const [videoFailed, setVideoFailed] = useState(false);
  // Phone-width screens get the portrait cut when the video has one.
  const [phone, setPhone] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [hasDock, setHasDock] = useState(dockCount > 0);
  const openedDuringNudge = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${basePath}/help/videos.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((m: HelpManifest | null) => { if (!cancelled && m) setManifest(m); })
      .catch(() => { /* no manifest: Help shows nothing */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const sync = () => setHasDock(dockCount > 0);
    sync();
    window.addEventListener(DOCK_EVENT, sync);
    return () => window.removeEventListener(DOCK_EVENT, sync);
  }, []);

  const setNudge = useCallback((on: boolean) => {
    nudging = on;
    window.dispatchEvent(new CustomEvent(NUDGE_EVENT, { detail: on }));
  }, []);

  // Open requests from the dock, the standalone button, or WelcomeAutoOpen.
  useEffect(() => {
    if (!manifest) return;
    const onOpen = (e: Event) => {
      const { source: src, videoId } = (e as CustomEvent<{ source: string; videoId?: string }>).detail ?? {};
      const v = (videoId && manifest.videos.find((x) => x.id === videoId)) || resolveHelpVideo(window.location.pathname.slice(basePath.length) || "/", manifest);
      if (!v) return;
      if (nudging) { openedDuringNudge.current = true; setNudge(false); }
      const isPhone = window.matchMedia(PHONE_QUERY).matches;
      setVideoFailed(false);
      setSource(src ?? "dock");
      setPhone(isPhone);
      setVideo(v);
      trackClient("help_open", { video: v.id, source: src, path: window.location.pathname, cut: isPhone && v.mobileSrc ? "mobile" : "desktop" });
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, [manifest, setNudge]);

  // Count sessions once per browser tab session.
  useEffect(() => {
    if (safeGet(sessionStorage, SS_SESSION)) return;
    safeSet(sessionStorage, SS_SESSION, "1");
    const s = readNudgeState();
    writeNudgeState({ ...s, sessions: s.sessions + 1 });
  }, []);

  // Idle nudge: pulse the Help button after NUDGE_IDLE_MS with no input, on
  // routes that opt in, within the session and dismissal caps.
  useEffect(() => {
    if (!manifest || video) return;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let showTimer: ReturnType<typeof setTimeout> | undefined;

    const endNudge = () => {
      if (!nudging) return;
      setNudge(false);
      if (!openedDuringNudge.current) {
        const s = readNudgeState();
        writeNudgeState({ ...s, dismissals: s.dismissals + 1 });
      }
      openedDuringNudge.current = false;
    };

    const fire = () => {
      const s = readNudgeState();
      if (!shouldNudge(pathname, manifest, s)) return;
      writeNudgeState({ ...s, nudgedPaths: [...s.nudgedPaths, pathname] });
      openedDuringNudge.current = false;
      setNudge(true);
      trackClient("help_nudge", { path: pathname });
      showTimer = setTimeout(endNudge, NUDGE_SHOW_MS);
    };

    const reset = () => {
      if (nudging) return; // let the pulse finish; it ends on open or timeout
      clearTimeout(idleTimer);
      idleTimer = setTimeout(fire, NUDGE_IDLE_MS);
    };

    const events = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;
    events.forEach((ev) => window.addEventListener(ev, reset, { passive: true, capture: true }));
    reset();
    return () => {
      events.forEach((ev) => window.removeEventListener(ev, reset, { capture: true }));
      clearTimeout(idleTimer);
      clearTimeout(showTimer);
      endNudge();
    };
  }, [manifest, pathname, video, setNudge]);

  const close = useCallback(() => setVideo(null), []);

  useEffect(() => {
    if (!video) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [video, close]);

  const [copiedKind, setCopiedKind] = useState<string | null>(null);

  const runAction = async (action: HelpAction) => {
    if (!video) return;
    trackClient("help_cta_click", { video: video.id, cta: action.label, kind: action.kind, source });
    const flash = () => { setCopiedKind(action.kind); setTimeout(() => setCopiedKind(null), 1600); };
    switch (action.kind) {
      case "copy-setup":
        try {
          await navigator.clipboard.writeText(setupPrompt(window.location.origin + basePath));
          flash();
        } catch {
          toast.error("Couldn't copy. Open the setup instructions instead.");
        }
        break;
      case "copy-page": {
        const slug = pathname.startsWith("/pages/") ? pathname.slice("/pages/".length).split("/")[0] : null;
        if (!slug) return;
        const title = document.title.replace(/\s*[|·-]\s*curata.*$/i, "") || slug;
        const result = await copyPagesForAgent(title, [{ slug, title }]);
        if (result === "ok") flash();
        else toast.error("Couldn't copy. Check your connection and try again.");
        break;
      }
      case "copy-prompt": {
        if (!action.prompt) return;
        const slug = pathname.startsWith("/pages/") ? pathname.slice("/pages/".length).split("/")[0] : null;
        try {
          await navigator.clipboard.writeText(fillPrompt(action.prompt, { origin: window.location.origin + basePath, slug }));
          flash();
        } catch {
          toast.error("Couldn't copy. Try again.");
        }
        break;
      }
      case "connect-agent":
        setVideo(null);
        setConnectOpen(true);
        break;
      case "link":
        if (!action.href) return;
        setVideo(null);
        window.location.assign(`${basePath}${action.href}`);
        break;
    }
  };

  const connectSlug = pathname.startsWith("/pages/") ? pathname.slice("/pages/".length) : "home";

  const portrait = phone && !!video?.mobileSrc;

  return (
    <>
      {!hasDock && manifest && !video && (
        <div className="page-dock page-dock--help-only" role="toolbar" aria-label="Help">
          <HelpButton source="standalone" />
        </div>
      )}
      {video && (
        <div className="agent-overlay help-overlay" onClick={close}>
          <div className={`agent-modal help-modal${portrait ? " help-modal--portrait" : ""}`} role="dialog" aria-modal="true" aria-label={video.title} onClick={(e) => e.stopPropagation()}>
            <div className="agent-modal-header">
              <span className="agent-modal-title">{video.title}</span>
              <button className="agent-modal-close" onClick={close} aria-label="Close">&#x2715;</button>
            </div>
            <div className="help-player">
              {videoFailed ? (
                <div className="help-player-missing">This video is on its way. Check back soon.</div>
              ) : (
                <video
                  key={`${video.id}-${portrait ? "m" : "d"}`}
                  src={`${basePath}${portrait ? video.mobileSrc : video.src}`}
                  poster={(portrait ? video.mobilePoster : video.poster) ? `${basePath}${portrait ? video.mobilePoster : video.poster}` : undefined}
                  controls
                  autoPlay
                  playsInline
                  preload="metadata"
                  onPlay={() => trackClient("help_video_play", { video: video.id, source })}
                  onEnded={() => trackClient("help_video_complete", { video: video.id, source })}
                  onError={() => setVideoFailed(true)}
                />
              )}
            </div>
            {(video.blurb || video.actions?.length) && (
              <div className="help-footer">
                {video.blurb && <p className="help-blurb">{video.blurb}</p>}
                {!!video.actions?.length && (
                  <div className="help-actions">
                    {video.actions.map((a, i) => (
                      <button
                        key={a.kind + a.label}
                        type="button"
                        className={i === 0 ? "help-next" : "help-secondary"}
                        onClick={() => void runAction(a)}
                      >
                        {copiedKind === a.kind ? "Copied" : a.label}
                        {a.kind === "link" && <span aria-hidden> →</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {connectOpen && (
        <AgentConnectModal slug={connectSlug} onClose={() => setConnectOpen(false)} authMode={authMode} />
      )}
    </>
  );
}
