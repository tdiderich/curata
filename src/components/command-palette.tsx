"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { basePath } from "@/lib/api-fetch";

interface SearchResult {
  slug: string;
  title: string;
  matches: string[];
  type: "page" | "prompt";
  prompt?: string;
}

type SearchState = "idle" | "loading" | "done" | "error";

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState(-1);
  const [state, setState] = useState<SearchState>("idle");
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    function onOpenEvent() {
      setOpen(true);
    }
    document.addEventListener("keydown", onKey);
    window.addEventListener("curata-open-palette", onOpenEvent);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("curata-open-palette", onOpenEvent);
    };
  }, []);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuery("");
      setResults([]);
      setSelected(-1);
      setState("idle");
      setCopiedSlug(null);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!copiedSlug) return;
    const t = setTimeout(() => setCopiedSlug(null), 1600);
    return () => clearTimeout(t);
  }, [copiedSlug]);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setState("idle");
      return;
    }
    const seq = ++seqRef.current;
    setState("loading");
    try {
      const res = await fetch(`${basePath}/api/search?query=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as SearchResult[];
      if (seq !== seqRef.current) return;
      setResults(data);
      setSelected(-1);
      setState("done");
    } catch {
      if (seq !== seqRef.current) return;
      setResults([]);
      setState("error");
    }
  }, []);

  function onInput(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(val), 200);
  }

  function activate(r: SearchResult) {
    if (r.type === "prompt" && r.prompt) {
      navigator.clipboard.writeText(r.prompt).then(() => {
        setCopiedSlug(r.slug + ":" + r.title);
      }).catch(() => {});
    } else {
      setOpen(false);
      router.push(`/pages/${r.slug}`);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter" && selected >= 0 && results[selected]) {
      e.preventDefault();
      activate(results[selected]);
    }
  }

  if (!open) return null;

  const trimmed = query.trim();
  const status =
    state === "loading"
      ? "Searching…"
      : state === "error"
        ? "Search unavailable"
        : state === "done" && trimmed
          ? results.length === 0
            ? "No results"
            : `${results.length} result${results.length === 1 ? "" : "s"}`
          : "";

  return (
    <div className="site-search-overlay" role="presentation" onKeyDown={onKeyDown}>
      <div className="site-search-backdrop" onClick={() => setOpen(false)} />
      <div className="site-search-dialog" role="dialog" aria-modal="true" aria-label="Search">
        <div className="site-search-input-wrap">
          <svg
            className="site-search-icon"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            type="search"
            className="site-search-input"
            placeholder="Search pages and prompts..."
            aria-label="Search pages and prompts"
            autoComplete="off"
            value={query}
            onChange={onInput}
          />
          <kbd className="site-search-kbd">esc</kbd>
        </div>
        <div className="sr-only" role="status" aria-live="polite">
          {status}
        </div>
        <div className="site-search-results">
          {state === "loading" && results.length === 0 && (
            <div className="site-search-empty">Searching…</div>
          )}
          {state === "error" && (
            <div className="site-search-empty">
              Search is unavailable right now — check your connection and try again.
            </div>
          )}
          {state === "done" && trimmed && results.length === 0 && (
            <div className="site-search-empty">
              No results for &ldquo;{trimmed}&rdquo;. Try fewer or different words.
            </div>
          )}
          {results.map((r, i) => {
            const key = r.slug + ":" + r.title;
            const isCopied = copiedSlug === key;
            return (
              <button
                key={key + i}
                className={`site-search-hit${i === selected ? " site-search-hit-active" : ""}${r.type === "prompt" ? " site-search-hit--prompt" : ""}`}
                onClick={() => activate(r)}
                onMouseEnter={() => setSelected(i)}
              >
                <span className="site-search-hit-title">
                  {r.title}
                  <span className={`site-search-hit-type site-search-hit-type--${r.type}`}>
                    {isCopied ? "Copied ✓" : r.type === "prompt" ? "Prompt" : "Page"}
                  </span>
                </span>
                {r.matches[0] && <span className="site-search-hit-desc">{r.matches[0]}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
