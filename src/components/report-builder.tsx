"use client";

import { useState, useMemo } from "react";
import { toast } from "./toast";
import { basePath } from "@/lib/api-fetch";

interface ReportBuilderProps {
  onClose: () => void;
  allPages: Array<{ slug: string; title: string }>;
  initialSlugs?: string[];
}

export default function ReportBuilder({ onClose, allPages, initialSlugs = [] }: ReportBuilderProps) {
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Array<{ slug: string; title: string }>>(
    () => initialSlugs.flatMap((s) => {
      const page = allPages.find((p) => p.slug === s);
      return page ? [page] : [];
    })
  );
  const [generating, setGenerating] = useState(false);

  const selectedSlugs = useMemo(() => new Set(selected.map((p) => p.slug)), [selected]);

  const available = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allPages.filter((p) => {
      if (selectedSlugs.has(p.slug)) return false;
      if (!q) return true;
      return p.title.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q);
    });
  }, [allPages, selectedSlugs, search]);

  function addPage(page: { slug: string; title: string }) {
    setSelected((prev) => [...prev, page]);
  }

  function removePage(index: number) {
    setSelected((prev) => prev.filter((_, i) => i !== index));
  }

  function moveUp(index: number) {
    if (index === 0) return;
    setSelected((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }

  function moveDown(index: number) {
    setSelected((prev) => {
      if (index === prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }

  async function handleGenerate() {
    if (selected.length === 0) {
      toast.error("Add at least one page to the report.");
      return;
    }
    if (!title.trim()) {
      toast.error("Enter a report title.");
      return;
    }

    setGenerating(true);
    toast.success("Generating report PDF…");

    try {
      const res = await fetch(`${basePath}/api/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slugs: selected.map((p) => p.slug),
          title: title.trim(),
          subtitle: subtitle.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Export failed" }));
        toast.error((data as { error?: string }).error || "Export failed");
        setGenerating(false);
        return;
      }

      const cd = res.headers.get("Content-Disposition") ?? "";
      const match = cd.match(/filename="?([^"]+)"?/);
      const filename = match?.[1] ?? `${title.trim().replace(/\s+/g, "-").toLowerCase()}.pdf`;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Report PDF downloaded");
      onClose();
    } catch {
      toast.error("Export failed — check your connection and try again.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "var(--bg)",
          border: "1px solid rgba(var(--text-rgb), 0.12)",
          borderRadius: 10,
          boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
          width: 700,
          maxWidth: "calc(100vw - 32px)",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "1px solid rgba(var(--text-rgb), 0.08)",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--snow)",
            }}
          >
            Build Report
          </span>
          <button
            className="agent-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {/* Title / subtitle inputs */}
        <div
          style={{
            padding: "16px 20px 0",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            flexShrink: 0,
          }}
        >
          <input
            type="text"
            placeholder="Report title (required)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{
              background: "rgba(var(--text-rgb), 0.05)",
              border: "1px solid rgba(var(--text-rgb), 0.12)",
              borderRadius: 6,
              color: "var(--snow)",
              fontSize: 14,
              fontWeight: 600,
              padding: "8px 12px",
              fontFamily: "inherit",
              outline: "none",
              width: "100%",
              boxSizing: "border-box",
            }}
            onFocus={(e) => (e.target.style.borderColor = "rgba(var(--accent-rgb), 0.4)")}
            onBlur={(e) => (e.target.style.borderColor = "rgba(var(--text-rgb), 0.12)")}
          />
          <input
            type="text"
            placeholder="Subtitle (optional)"
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            style={{
              background: "rgba(var(--text-rgb), 0.05)",
              border: "1px solid rgba(var(--text-rgb), 0.12)",
              borderRadius: 6,
              color: "var(--snow)",
              fontSize: 13,
              padding: "7px 12px",
              fontFamily: "inherit",
              outline: "none",
              width: "100%",
              boxSizing: "border-box",
            }}
            onFocus={(e) => (e.target.style.borderColor = "rgba(var(--accent-rgb), 0.4)")}
            onBlur={(e) => (e.target.style.borderColor = "rgba(var(--text-rgb), 0.12)")}
          />
        </div>

        {/* Two-panel body */}
        <div
          style={{
            display: "flex",
            gap: 0,
            flex: 1,
            minHeight: 0,
            padding: "16px 20px",
          }}
        >
          {/* Left: available pages */}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              gap: 8,
              paddingRight: 12,
              borderRight: "1px solid rgba(var(--text-rgb), 0.08)",
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.07em",
                color: "var(--muted)",
                flexShrink: 0,
              }}
            >
              Available pages
            </div>
            {/* Search */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "rgba(var(--text-rgb), 0.05)",
                border: "1px solid rgba(var(--text-rgb), 0.12)",
                borderRadius: 6,
                padding: "4px 10px",
                flexShrink: 0,
              }}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="none"
                stroke="var(--muted)"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <circle cx="6.5" cy="6.5" r="4.5" />
                <line x1="10.5" y1="10.5" x2="14" y2="14" />
              </svg>
              <input
                type="text"
                placeholder="Filter pages…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  background: "none",
                  border: "none",
                  outline: "none",
                  color: "var(--snow)",
                  fontSize: 12,
                  fontFamily: "inherit",
                  flex: 1,
                  minWidth: 0,
                }}
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--muted)",
                    cursor: "pointer",
                    fontSize: 14,
                    lineHeight: 1,
                    padding: 0,
                  }}
                >
                  &times;
                </button>
              )}
            </div>
            {/* List */}
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 1,
              }}
            >
              {available.length === 0 ? (
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--muted)",
                    padding: "12px 0",
                    textAlign: "center",
                  }}
                >
                  {search ? "No matching pages" : "All pages added"}
                </div>
              ) : (
                available.map((page) => (
                  <button
                    key={page.slug}
                    onClick={() => addPage(page)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      background: "none",
                      border: "1px solid transparent",
                      borderRadius: 5,
                      padding: "6px 8px",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      textAlign: "left",
                      gap: 8,
                      transition: "background 0.1s, border-color 0.1s",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = "rgba(var(--text-rgb), 0.04)";
                      (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(var(--text-rgb), 0.08)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = "none";
                      (e.currentTarget as HTMLButtonElement).style.borderColor = "transparent";
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: "var(--snow)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {page.title}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--muted)",
                          fontFamily: "ui-monospace, monospace",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {page.slug}
                      </div>
                    </div>
                    <span
                      style={{
                        fontSize: 18,
                        color: "var(--teal)",
                        lineHeight: 1,
                        flexShrink: 0,
                      }}
                    >
                      +
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Right: selected pages */}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              gap: 8,
              paddingLeft: 12,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                  color: "var(--muted)",
                }}
              >
                Report pages
              </span>
              {selected.length > 0 && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: "1px 6px",
                    borderRadius: 10,
                    background: "rgba(var(--accent-rgb), 0.12)",
                    color: "var(--teal)",
                  }}
                >
                  {selected.length}
                </span>
              )}
            </div>
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              {selected.length === 0 ? (
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--muted)",
                    padding: "12px 8px",
                    textAlign: "center",
                  }}
                >
                  Add pages from the left
                </div>
              ) : (
                selected.map((page, i) => (
                  <div
                    key={page.slug}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "6px 8px",
                      background: "rgba(var(--text-rgb), 0.03)",
                      border: "1px solid rgba(var(--text-rgb), 0.07)",
                      borderRadius: 5,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: "var(--muted)",
                        minWidth: 16,
                        textAlign: "right",
                        flexShrink: 0,
                      }}
                    >
                      {i + 1}.
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: "var(--snow)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {page.title}
                      </div>
                    </div>
                    {/* Up / Down / Remove */}
                    <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                      <button
                        onClick={() => moveUp(i)}
                        disabled={i === 0}
                        title="Move up"
                        style={{
                          background: "none",
                          border: "1px solid rgba(var(--text-rgb), 0.10)",
                          borderRadius: 4,
                          color: i === 0 ? "rgba(var(--text-rgb), 0.2)" : "var(--muted)",
                          cursor: i === 0 ? "not-allowed" : "pointer",
                          fontSize: 11,
                          lineHeight: 1,
                          padding: "2px 5px",
                          fontFamily: "inherit",
                        }}
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => moveDown(i)}
                        disabled={i === selected.length - 1}
                        title="Move down"
                        style={{
                          background: "none",
                          border: "1px solid rgba(var(--text-rgb), 0.10)",
                          borderRadius: 4,
                          color: i === selected.length - 1 ? "rgba(var(--text-rgb), 0.2)" : "var(--muted)",
                          cursor: i === selected.length - 1 ? "not-allowed" : "pointer",
                          fontSize: 11,
                          lineHeight: 1,
                          padding: "2px 5px",
                          fontFamily: "inherit",
                        }}
                      >
                        ↓
                      </button>
                      <button
                        onClick={() => removePage(i)}
                        title="Remove"
                        style={{
                          background: "none",
                          border: "1px solid rgba(var(--text-rgb), 0.10)",
                          borderRadius: 4,
                          color: "var(--muted)",
                          cursor: "pointer",
                          fontSize: 13,
                          lineHeight: 1,
                          padding: "2px 5px",
                          fontFamily: "inherit",
                        }}
                      >
                        &times;
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 20px",
            borderTop: "1px solid rgba(var(--text-rgb), 0.08)",
            flexShrink: 0,
            gap: 12,
          }}
        >
          <span
            style={{
              fontSize: 12,
              color: "var(--muted)",
            }}
          >
            {selected.length} page{selected.length !== 1 ? "s" : ""} in report
          </span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              className="ann-form-cancel"
              onClick={onClose}
              style={{ fontSize: 13 }}
            >
              Cancel
            </button>
            <button
              onClick={handleGenerate}
              disabled={generating || selected.length === 0 || !title.trim()}
              style={{
                background: "var(--teal)",
                color: "var(--bg)",
                border: "none",
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                padding: "7px 18px",
                cursor: generating || selected.length === 0 || !title.trim() ? "not-allowed" : "pointer",
                fontFamily: "inherit",
                opacity: generating || selected.length === 0 || !title.trim() ? 0.45 : 1,
                transition: "opacity 0.15s",
              }}
            >
              {generating ? "Generating…" : "Generate PDF"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
