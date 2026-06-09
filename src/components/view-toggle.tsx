"use client";

import { useEffect, useState } from "react";

export type DashView = "feed" | "table";

const STORAGE_KEY = "curata-dash-view";

interface ViewToggleProps {
  view: DashView;
  onChange: (view: DashView) => void;
}

export function ViewToggle({ view, onChange }: ViewToggleProps) {
  return (
    <div className="dash-view-toggle">
      <button
        className={`dash-view-btn${view === "feed" ? " dash-view-btn--active" : ""}`}
        onClick={() => onChange("feed")}
        aria-pressed={view === "feed"}
      >
        Feed
      </button>
      <button
        className={`dash-view-btn${view === "table" ? " dash-view-btn--active" : ""}`}
        onClick={() => onChange("table")}
        aria-pressed={view === "table"}
      >
        Table
      </button>
    </div>
  );
}

export function useDashView(): [DashView, (v: DashView) => void] {
  const [view, setView] = useState<DashView>("feed");

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as DashView | null;
    if (stored === "feed" || stored === "table") {
      setView(stored); // eslint-disable-line react-hooks/set-state-in-effect
    }
  }, []);

  function setAndPersist(v: DashView) {
    setView(v);
    localStorage.setItem(STORAGE_KEY, v);
  }

  return [view, setAndPersist];
}
