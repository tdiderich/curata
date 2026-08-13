"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { KnowledgeGraph } from "./knowledge-graph";
import { TagPicker, type TagOption } from "./tag-picker";
import type { KnowledgeGraph as GraphData, UntaggedPage } from "@/lib/graph";
import { DEFAULT_TAGS } from "@/lib/default-tags";
import { basePath } from "@/lib/api-fetch";

interface Props {
  graph: GraphData;
  activity: ReactNode;
}

type Tab = "graph" | "activity";

const PageIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
  </svg>
);

function UntaggedRow({
  page,
  tagOptions,
  onTagged,
}: {
  page: UntaggedPage;
  tagOptions: TagOption[];
  onTagged: (id: string) => void;
}) {
  const save = async (tags: TagOption[]) => {
    const res = await fetch(`${basePath}/api/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageId: page.id, tags }),
    }).catch(() => null);
    if (res?.ok) {
      onTagged(page.id);
      return true;
    }
    return false;
  };

  return (
    <li className="activity-row kg-untagged-row">
      <span className="activity-icon">
        <PageIcon />
      </span>
      <span className="activity-content">
        <span className="activity-body">
          <Link href={`/pages/${page.slug}`} className="activity-link">
            {page.title}
          </Link>
        </span>
        <span className="activity-meta">
          updated{" "}
          <span className="activity-time">{new Date(page.updatedAt).toLocaleDateString()}</span>
        </span>
      </span>
      <TagPicker options={tagOptions} onSave={save} />
    </li>
  );
}

export function DashboardTabs({ graph, activity }: Props) {
  const [tab, setTab] = useState<Tab>("graph");
  const [untagged, setUntagged] = useState(graph.untagged);

  const tagOptions = useMemo(() => {
    const map = new Map<string, string>(DEFAULT_TAGS.map((t) => [t, ""]));
    for (const t of graph.tags) map.set(t.name.toLowerCase(), t.conceptKind ?? "");
    return [...map.entries()].map(([term, kind]) => ({ term, kind }));
  }, [graph.tags]);

  const untaggedPanel =
    untagged.length === 0 ? (
      <div className="kg-empty">Everything is tagged. The whole brain is visible to agents.</div>
    ) : (
      <>
        <p className="kg-untagged-note">
          {untagged.length} pages aren&apos;t tagged yet. Still searchable, just not part of the
          tagged knowledge agents pull in by default.
        </p>
        <ul className="activity-list kg-untagged-scroll">
          {untagged.map((p) => (
            <UntaggedRow
              key={p.id}
              page={p}
              tagOptions={tagOptions}
              onTagged={(id) => setUntagged((u) => u.filter((x) => x.id !== id))}
            />
          ))}
        </ul>
      </>
    );

  return (
    <div>
      <div className="kg-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "graph"}
          className={tab === "graph" ? "kg-tab kg-tab-active" : "kg-tab"}
          onClick={() => setTab("graph")}
        >
          Knowledge graph
        </button>
        <button
          role="tab"
          aria-selected={tab === "activity"}
          className={tab === "activity" ? "kg-tab kg-tab-active" : "kg-tab"}
          onClick={() => setTab("activity")}
        >
          Activity
        </button>
      </div>

      {tab === "graph" && (
        <KnowledgeGraph
          tags={graph.tags}
          pages={graph.pages}
          edges={graph.edges}
          untaggedCount={untagged.length}
          untaggedPanel={untaggedPanel}
        />
      )}

      {tab === "activity" && activity}
    </div>
  );
}
