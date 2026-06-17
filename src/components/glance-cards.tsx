"use client";

import { useEffect, useState } from "react";
import type { GlanceCard as GlanceCardData } from "@/lib/glance-prompts";
import { GlanceCard } from "@/components/glance-card";

const HIDDEN_KEY = "curata-glance-hidden";

function readHidden(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

export interface CardSection {
  label: string;
  cards: GlanceCardData[];
}

export function GlanceCards({ sections }: { sections: CardSection[] }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

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

  const toggleSection = (label: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });

  if (!loaded) return <div className="home-glance-cards" />;

  const allCards = sections.flatMap((s) => s.cards);
  const hiddenCount = allCards.filter((c) => hidden.has(c.title)).length;

  return (
    <>
      {sections.map((section) => {
        const visible = section.cards.filter((c) => !hidden.has(c.title));
        if (visible.length === 0) return null;
        const isCollapsed = collapsed.has(section.label);
        const emptyCount = visible.filter((c) => !c.prompt).length;
        return (
          <div key={section.label} className="glance-section">
            <button
              type="button"
              className="glance-section-header"
              onClick={() => toggleSection(section.label)}
            >
              <span className="glance-section-label">{section.label}</span>
              <span className="glance-section-count">
                {visible.length} card{visible.length === 1 ? "" : "s"}
                {emptyCount > 0 && ` · ${emptyCount} clear`}
              </span>
              <span className={`glance-section-chevron${isCollapsed ? " glance-section-chevron--collapsed" : ""}`}>
                &#x25BE;
              </span>
            </button>
            {!isCollapsed && (
              <div className="home-glance-cards">
                {visible.map((card) => (
                  <GlanceCard key={card.title} card={card} onDismiss={() => dismiss(card.title)} />
                ))}
              </div>
            )}
          </div>
        );
      })}
      {hiddenCount > 0 && (
        <button type="button" className="glance-restore" onClick={restoreAll}>
          {hiddenCount} hidden card{hiddenCount === 1 ? "" : "s"} — restore
        </button>
      )}
    </>
  );
}
