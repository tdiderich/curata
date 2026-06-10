"use client";

import { useEffect, useState } from "react";
import type { GlanceCard as GlanceCardData } from "@/lib/glance-prompts";
import { GlanceCard } from "@/components/glance-card";

// Per-browser card dismissal. Hiding is a view preference, not data: the
// underlying home-page sections/prompts are untouched, and a workflow refresh
// doesn't resurrect hidden cards on this browser. Custom cards can be removed
// permanently by editing the prompts: block on /pages/home.
const HIDDEN_KEY = "curata-glance-hidden";

function readHidden(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

export function GlanceCards({ cards }: { cards: GlanceCardData[] }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHidden(readHidden());
    setLoaded(true);
  }, []);

  const persist = (next: Set<string>) => {
    setHidden(next);
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]));
  };

  const dismiss = (title: string) => persist(new Set([...hidden, title]));
  const restoreAll = () => persist(new Set());

  if (!loaded) return <div className="home-glance-cards" />;

  const visible = cards.filter((c) => !hidden.has(c.title));
  const hiddenCount = cards.length - visible.length;

  return (
    <>
      <div className="home-glance-cards">
        {visible.map((card) => (
          <GlanceCard key={card.title} card={card} onDismiss={() => dismiss(card.title)} />
        ))}
      </div>
      {hiddenCount > 0 && (
        <button type="button" className="glance-restore" onClick={restoreAll}>
          {hiddenCount} hidden card{hiddenCount === 1 ? "" : "s"} — restore
        </button>
      )}
    </>
  );
}
