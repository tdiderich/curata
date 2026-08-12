"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { KnowledgeGraph } from "./knowledge-graph";
import type { KnowledgeGraph as GraphData } from "@/lib/graph";

interface Props {
  graph: GraphData;
  activity: ReactNode;
}

type Tab = "graph" | "untagged" | "activity";

export function DashboardTabs({ graph, activity }: Props) {
  const [tab, setTab] = useState<Tab>("graph");

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
          aria-selected={tab === "untagged"}
          className={tab === "untagged" ? "kg-tab kg-tab-active" : "kg-tab"}
          onClick={() => setTab("untagged")}
        >
          Untagged ({graph.untagged.length})
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
          suggestedTags={graph.suggestedTags}
        />
      )}

      {tab === "untagged" && (
        <div className="kg-untagged">
          {graph.untagged.length === 0 ? (
            <div className="kg-empty">Everything is tagged. The whole brain is visible to agents.</div>
          ) : (
            <>
              <p className="kg-untagged-note">
                These pages are invisible to agents — they never appear in the brain map or this
                graph until they carry at least one tag.
              </p>
              <ul className="kg-untagged-list">
                {graph.untagged.map((p) => (
                  <li key={p.id}>
                    <Link href={`/pages/${p.slug}`}>{p.title}</Link>
                    <span className="kg-untagged-date">
                      {new Date(p.updatedAt).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {tab === "activity" && activity}
    </div>
  );
}
