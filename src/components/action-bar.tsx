"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { basePath } from "@/lib/api-fetch";
import { getPageActions, type PageAction } from "@/lib/page-actions";
import type { ActionBarPage } from "@/components/action-bar-types";

interface SearchResult {
  slug: string;
  title: string;
  matches: string[];
  type: "page" | "prompt";
  prompt?: string;
  trusted?: boolean;
  trustedBehind?: boolean;
}

interface ActionBarProps {
  orgName: string;
  logoUrl: string | null;
  pages: ActionBarPage[];
  authControls: React.ReactNode;
}

function SearchIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

export function ActionBar({ orgName, logoUrl, pages, authControls }: ActionBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState(-1);
  const [actions, setActions] = useState<PageAction[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOverlayOpen((v) => !v);
      }
    }
    function onOpenEvent() {
      setOverlayOpen(true);
    }
    document.addEventListener("keydown", onKey);
    window.addEventListener("curata-open-palette", onOpenEvent);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("curata-open-palette", onOpenEvent);
    };
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!overlayOpen) return;
    const sync = () => setActions(getPageActions());
    sync();
    window.addEventListener("curata-page-actions", sync);
    return () => window.removeEventListener("curata-page-actions", sync);
  }, [overlayOpen]);

  useEffect(() => {
    if (overlayOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuery("");
      setResults([]);
      setSelected(-1);
      setSearching(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [overlayOpen]);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setSearching(false);
      return;
    }
    const seq = ++seqRef.current;
    setSearching(true);
    try {
      const res = await fetch(`${basePath}/api/search?query=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as SearchResult[];
      if (seq !== seqRef.current) return;
      setResults(data);
      setSelected(-1);
      setSearching(false);
    } catch {
      if (seq !== seqRef.current) return;
      setResults([]);
      setSearching(false);
    }
  }, []);

  function onInput(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(val), 200);
  }

  const trimmed = query.trim().toLowerCase();
  const shownActions = trimmed
    ? actions.filter((a) => a.label.toLowerCase().includes(trimmed))
    : actions;

  const shownPages = (trimmed
    ? pages.filter((p) => p.title.toLowerCase().includes(trimmed))
    : pages
  ).slice(0, 20);

  const navSlugs = new Set(shownPages.map((p) => p.slug));
  const filteredResults = results.filter((r) => !navSlugs.has(r.slug));

  const totalItems = shownActions.length + shownPages.length + filteredResults.length;

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      setOverlayOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, totalItems - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter" && selected >= 0) {
      e.preventDefault();
      if (selected < shownActions.length) {
        const a = shownActions[selected];
        setOverlayOpen(false);
        a.run();
      } else if (selected < shownActions.length + shownPages.length) {
        const p = shownPages[selected - shownActions.length];
        setOverlayOpen(false);
        router.push(`/pages/${p.slug}`);
      } else {
        const r = filteredResults[selected - shownActions.length - shownPages.length];
        if (r.type === "prompt" && r.prompt) {
          navigator.clipboard.writeText(r.prompt).catch(() => {});
        } else {
          setOverlayOpen(false);
          router.push(`/pages/${r.slug}`);
        }
      }
    }
  }

  const isLanding = pathname === "/dashboard" || pathname === "/";

  return (
    <>
      {!isLanding && <header className={`ab-topbar${scrolled ? " ab-topbar--scrolled" : ""}`}>
        <Link href="/dashboard" className="ab-logo" title={orgName}>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={orgName} className="ab-logo-img" />
          ) : (
            <>
              <svg className="ab-logo-mark" viewBox="0 0 32 32" fill="none" aria-hidden="true">
                <path d="M 24.43 8.93 A 11 11 0 1 0 24.43 23.07" stroke="rgb(var(--accent-rgb))" strokeWidth="3.5" strokeLinecap="round" />
                <circle cx="27.2" cy="16" r="3.4" fill="rgba(var(--accent-rgb), 0.5)" />
              </svg>
              <span className="ab-logo-text">{orgName}</span>
            </>
          )}
        </Link>
        <div className="ab-search-area">
          <div className="ab-search-trigger" onClick={() => setOverlayOpen(true)}>
            <SearchIcon />
            <span className="ab-search-placeholder">Search or take action...</span>
            <kbd className="ab-search-kbd">{"⌘"}K</kbd>
          </div>
        </div>
        <div className="ab-auth">{authControls}</div>
      </header>}

      {overlayOpen && (
        <div className="ab-overlay" onClick={() => setOverlayOpen(false)}>
          <div className="ab-overlay-panel" onClick={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
            <div className="ab-overlay-search">
              <SearchIcon size={16} />
              <input
                ref={inputRef}
                type="search"
                className="ab-overlay-input"
                placeholder="Search pages and actions..."
                autoComplete="off"
                value={query}
                onChange={onInput}
              />
              <kbd className="ab-search-kbd">esc</kbd>
            </div>
            <div className="ab-overlay-body">
              {shownActions.length > 0 && (
                <>
                  <div className="ab-section-label">Page actions</div>
                  {shownActions.map((a, i) => (
                    <button
                      key={a.id}
                      className={`ab-action-item${i === selected ? " ab-item-active" : ""}`}
                      onClick={() => { setOverlayOpen(false); a.run(); }}
                      onMouseEnter={() => setSelected(i)}
                    >
                      <span>{a.label}</span>
                      {a.hint && <span className="ab-action-hint">{a.hint}</span>}
                    </button>
                  ))}
                </>
              )}
              {shownPages.length > 0 && (
                <>
                  <div className="ab-section-divider" />
                  <div className="ab-section-label">Navigate</div>
                  {shownPages.map((p, i) => {
                    const idx = shownActions.length + i;
                    return (
                      <button
                        key={p.slug}
                        className={`ab-action-item ab-nav-item${idx === selected ? " ab-item-active" : ""}`}
                        onClick={() => { setOverlayOpen(false); router.push(`/pages/${p.slug}`); }}
                        onMouseEnter={() => setSelected(idx)}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <path d="M14 2v6h6" />
                        </svg>
                        <span>{p.title}</span>
                      </button>
                    );
                  })}
                </>
              )}
              {searching && filteredResults.length === 0 && shownPages.length === 0 && (
                <div className="ab-overlay-empty">Searching...</div>
              )}
              {filteredResults.length > 0 && (
                <>
                  <div className="ab-section-divider" />
                  <div className="ab-section-label">Search results</div>
                  {filteredResults.map((r, i) => {
                    const idx = shownActions.length + shownPages.length + i;
                    return (
                      <button
                        key={`${r.slug}-${i}`}
                        className={`ab-action-item${idx === selected ? " ab-item-active" : ""}${r.type === "prompt" ? " ab-item-prompt" : ""}`}
                        onClick={() => {
                          if (r.type === "prompt" && r.prompt) {
                            navigator.clipboard.writeText(r.prompt).catch(() => {});
                          } else {
                            setOverlayOpen(false);
                            router.push(`/pages/${r.slug}`);
                          }
                        }}
                        onMouseEnter={() => setSelected(idx)}
                      >
                        <span>{r.title}</span>
                        {r.type === "page" && r.trustedBehind && (
                          <span className="pill vh-list-badge" title="A newer, unapproved version exists">behind</span>
                        )}
                        {r.type === "page" && !r.trustedBehind && !r.trusted && (
                          <span className="pill vh-list-badge" title="No version approved yet">untrusted</span>
                        )}
                        <span className="ab-action-hint">{r.type === "prompt" ? "Prompt" : "Page"}</span>
                      </button>
                    );
                  })}
                </>
              )}
              {trimmed && shownActions.length === 0 && filteredResults.length === 0 && shownPages.length === 0 && !searching && (
                <div className="ab-overlay-empty">
                  No results for &ldquo;{query.trim()}&rdquo;
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
