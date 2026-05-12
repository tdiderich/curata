"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

interface SearchResult {
  slug: string;
  title: string;
  matches: string[];
}

export function SearchBar() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/search?query=${encodeURIComponent(q)}`
      );
      if (res.ok) {
        const data = (await res.json()) as SearchResult[];
        setResults(data);
        setOpen(true);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  function onInput(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(val), 300);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  }

  function navigate(slug: string) {
    setOpen(false);
    setQuery("");
    router.push(`/pages/${slug}`);
  }

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="search-bar">
      <div className="search-bar-input-wrap">
        <svg
          className="search-bar-icon"
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10 10L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          className="search-bar-input"
          type="text"
          placeholder="Search pages&hellip;"
          value={query}
          onChange={onInput}
          onKeyDown={onKeyDown}
          aria-label="Search pages"
          autoComplete="off"
        />
        {loading && <span className="search-bar-spinner" aria-hidden="true" />}
      </div>
      {open && results.length > 0 && (
        <div className="search-dropdown">
          {results.map((r) => (
            <button
              key={r.slug}
              className="search-result"
              onClick={() => navigate(r.slug)}
            >
              <span className="search-result-title">{r.title}</span>
              {r.matches.slice(0, 2).map((m, i) => (
                <span key={`${r.slug}-${i}`} className="search-result-match">
                  {m}
                </span>
              ))}
            </button>
          ))}
        </div>
      )}
      {open && query.trim() && results.length === 0 && !loading && (
        <div className="search-dropdown">
          <span className="search-no-results">No results</span>
        </div>
      )}
    </div>
  );
}
