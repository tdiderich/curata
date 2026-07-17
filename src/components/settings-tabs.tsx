"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";

interface Tab {
  label: string;
  content: React.ReactNode;
}

function slugify(label: string) {
  return label.toLowerCase().replace(/\s+/g, "-");
}

export function SettingsTabs({ tabs }: { tabs: Tab[] }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const resolveIndex = useCallback(() => {
    const param = searchParams.get("tab");
    if (!param) return 0;
    const idx = tabs.findIndex((t) => slugify(t.label) === param);
    return idx >= 0 ? idx : 0;
  }, [searchParams, tabs]);

  const [active, setActive] = useState(resolveIndex);

  useEffect(() => {
    queueMicrotask(() => setActive(resolveIndex()));
  }, [resolveIndex]);

  function selectTab(i: number) {
    setActive(i);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", slugify(tabs[i].label));
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="settings-tabs">
      <nav className="settings-tab-bar">
        {tabs.map((tab, i) => (
          <button
            key={tab.label}
            className={`settings-tab${i === active ? " settings-tab--active" : ""}`}
            onClick={() => selectTab(i)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <div className="settings-tab-content">
        {tabs[active].content}
      </div>
    </div>
  );
}
