"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";

interface PageRef {
  slug: string;
  title: string;
}

interface ConceptRow {
  term: string;
  kind: string;
  usageCount: number;
  pages: PageRef[];
}

interface LinkRow {
  from: string;
  to: string;
  rel: string;
}

interface Stats {
  totalConcepts: number;
  totalLinks: number;
  pagesWithConcepts: number;
  pagesWithoutConcepts: number;
}

interface Props {
  concepts: ConceptRow[];
  links: LinkRow[];
  stats: Stats;
}

export function ConceptExplorer({ concepts, links, stats }: Props) {
  const [selectedConcept, setSelectedConcept] = useState<string | null>(
    concepts.length > 0 ? concepts[0].term : null
  );
  const [kindFilter, setKindFilter] = useState<string>("");
  const [search, setSearch] = useState("");

  const kinds = useMemo(
    () => Array.from(new Set(concepts.map((c) => c.kind).filter(Boolean))).sort(),
    [concepts]
  );

  const filtered = useMemo(() => {
    let result = concepts;
    if (kindFilter) result = result.filter((c) => c.kind === kindFilter);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((c) => c.term.toLowerCase().includes(q));
    }
    return result;
  }, [concepts, kindFilter, search]);

  const selectedData = useMemo(() => {
    if (!selectedConcept) return null;
    return concepts.find((c) => c.term === selectedConcept) ?? null;
  }, [concepts, selectedConcept]);

  const selectedLinks = useMemo(() => {
    if (!selectedData) return [];
    const slugSet = new Set(selectedData.pages.map((p) => p.slug));
    return links.filter((l) => slugSet.has(l.from) || slugSet.has(l.to));
  }, [selectedData, links]);

  return (
    <div className="concepts-root">
      <div className="concepts-header">
        <div>
          <h1 className="concepts-title">Concepts</h1>
          <p className="concepts-subtitle">
            {stats.totalConcepts} terms across {stats.pagesWithConcepts} pages
            {stats.pagesWithoutConcepts > 0 && (
              <span className="concepts-gap"> · {stats.pagesWithoutConcepts} untagged</span>
            )}
            {stats.totalLinks > 0 && (
              <span> · {stats.totalLinks} links</span>
            )}
          </p>
        </div>
      </div>

      <div className="concepts-controls">
        <input
          type="text"
          className="concepts-search"
          placeholder="Filter concepts..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="concepts-kind-filter"
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
        >
          <option value="">All kinds</option>
          {kinds.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
      </div>

      <div className="concepts-layout">
        <div className="concepts-list">
          <table className="concepts-table">
            <thead>
              <tr>
                <th>Term</th>
                <th>Kind</th>
                <th>Pages</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr
                  key={c.term}
                  className={`concepts-row ${selectedConcept === c.term ? "concepts-row--active" : ""}`}
                  onClick={() => setSelectedConcept(selectedConcept === c.term ? null : c.term)}
                >
                  <td className="concepts-term">{c.term}</td>
                  <td>
                    {c.kind && <span className="concepts-kind-badge">{c.kind}</span>}
                  </td>
                  <td className="concepts-count">{c.usageCount}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={3} className="concepts-empty">
                    {concepts.length === 0
                      ? "No concepts yet. Run the semantic refresh workflow to tag your pages."
                      : "No concepts match your filter."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="concepts-detail">
          {selectedData ? (
            <>
              <h2 className="concepts-detail-title">{selectedData.term}</h2>
              {selectedData.kind && (
                <span className="concepts-kind-badge concepts-kind-badge--lg">{selectedData.kind}</span>
              )}
              <h3 className="concepts-detail-section">
                Pages ({selectedData.pages.length})
              </h3>
              <ul className="concepts-page-list">
                {selectedData.pages.map((p) => (
                  <li key={p.slug}>
                    <Link href={`/pages/${p.slug}`} className="concepts-page-link">
                      {p.title}
                    </Link>
                  </li>
                ))}
              </ul>
              {selectedLinks.length > 0 && (
                <>
                  <h3 className="concepts-detail-section">
                    Cross-page links ({selectedLinks.length})
                  </h3>
                  <ul className="concepts-link-list">
                    {selectedLinks.map((l, i) => (
                      <li key={i} className="concepts-link-item">
                        <Link href={`/pages/${l.from}`}>{l.from}</Link>
                        <span className="concepts-link-rel">{l.rel}</span>
                        <Link href={`/pages/${l.to}`}>{l.to}</Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          ) : (
            <div className="concepts-detail-empty">
              Click a concept to see which pages contain it
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
