"use client";

import Link from "next/link";
import { SerializedPageMeta } from "@/components/dashboard-client";

function relativeTime(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? "s" : ""} ago`;
  if (diffHr < 24) return `${diffHr} hour${diffHr !== 1 ? "s" : ""} ago`;
  if (diffDay === 1) return "yesterday";
  if (diffDay < 7) return `${diffDay} days ago`;
  if (diffDay < 14) return "last week";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function sourceLabel(createdBy: string): string {
  if (createdBy === "agent-api" || createdBy.startsWith("agent")) return "Agent";
  if (createdBy === "web") return "Web";
  return createdBy;
}

function VisibilityPill({ visibility }: { visibility: string }) {
  return (
    <span
      className={`dash-visibility-badge dash-visibility-badge--${visibility}`}
      style={{ cursor: "default" }}
    >
      {visibility}
    </span>
  );
}

function SourceBadge({ createdBy }: { createdBy: string }) {
  const label = sourceLabel(createdBy);
  const isAgent = label === "Agent";
  return (
    <span className="feed-source-badge" data-agent={isAgent ? "true" : undefined}>
      {label}
    </span>
  );
}

interface DashboardFeedProps {
  pages: SerializedPageMeta[];
}

export function DashboardFeed({ pages }: DashboardFeedProps) {
  if (pages.length === 0) {
    return (
      <div className="dash-empty">
        <div className="dash-empty-icon">&#128196;</div>
        <div className="dash-empty-title">No pages yet</div>
        <div className="dash-empty-text">Create a page or connect an agent to get started.</div>
      </div>
    );
  }

  return (
    <div className="feed-list">
      {pages.map((page) => (
        <div key={page.slug} className="feed-card">
          <div className="feed-card-header">
            <Link href={`/pages/${page.slug}`} className="feed-card-title">
              {page.title}
            </Link>
            <span className="feed-card-time">{relativeTime(page.lastActivity)}</span>
          </div>

          {page.snippet && page.snippet !== page.title && (
            <p className="feed-card-snippet">{page.snippet}</p>
          )}

          <div className="feed-card-meta">
            <SourceBadge createdBy={page.createdBy} />
            <VisibilityPill visibility={page.visibility} />
            {page.annotationCount > 0 && (
              <span className="feed-card-ann">
                {page.annotationCount} annotation{page.annotationCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
