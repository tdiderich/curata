"use client";

import { useEffect, useRef, useState } from "react";
import type { PageAction, PageActionIcon } from "@/lib/page-actions";

/**
 * Floating page-action dock: a vertical icon stack pinned bottom-right.
 * Always visible while viewing a page (preview tab); the parent hides it in
 * presentation mode, fullscreen decks, and while the component editor is open.
 * Labels appear as tooltips on hover/focus; the emphasized action (e.g. "Save
 * edits" in edit mode) is filled with the accent color.
 */

function Icon({ name }: { name: PageActionIcon }) {
  const p = { width: 15, height: 15, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (name) {
    case "copy":
      return <svg {...p}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>;
    case "edit":
      return <svg {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>;
    case "check":
      return <svg {...p}><path d="M20 6 9 17l-5-5" /></svg>;
    case "save":
      return <svg {...p}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" /><path d="M17 21v-8H7v8" /><path d="M7 3v5h8" /></svg>;
    case "present":
      return <svg {...p}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 21h8" /><path d="M12 16v5" /><path d="m10 8 4 2-4 2Z" /></svg>;
    case "pdf":
      return <svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /><path d="M9 15h6" /><path d="M9 18h4" /></svg>;
    case "discard":
      return <svg {...p}><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-15-6.7L3 13" /></svg>;
    case "folder":
      return <svg {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></svg>;
    case "report":
      return <svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /><path d="M8 17v-4" /><path d="M12 17v-7" /><path d="M16 17v-2" /></svg>;
    case "broom":
      return <svg {...p}><path d="m19 3-8.5 8.5" /><path d="M13 10 5.5 17.5a3 3 0 0 0 0 4l.5.5 1 -1a3 3 0 0 0 4 0L17 14Z" /><path d="M4 20l3-3" /></svg>;
    case "clock":
      return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
    case "zap":
      return <svg {...p}><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" /></svg>;
    case "plus":
      return <svg {...p}><path d="M12 5v14" /><path d="M5 12h14" /></svg>;
    case "settings":
      return <svg {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></svg>;
  }
}

export function PageActionDock({ actions, hidden }: { actions: PageAction[]; hidden?: boolean }) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpenMenu(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenMenu(null); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [openMenu]);

  if (hidden || actions.length === 0) return null;

  const primary = actions.find((a) => a.primary);
  const rest = actions.filter((a) => !a.primary);

  const renderBtn = (a: PageAction) => {
    if (a.children) {
      const open = openMenu === a.id;
      return (
        <div key={a.id} className="dock-menu-wrap">
          <button
            type="button"
            className={`dock-btn${open ? " dock-btn--open" : ""}`}
            onClick={() => setOpenMenu(open ? null : a.id)}
            aria-label={a.label}
            aria-haspopup="menu"
            aria-expanded={open}
          >
            {a.icon && <span className="dock-btn-icon"><Icon name={a.icon} /></span>}
            {!open && <span className="dock-tooltip" role="presentation">{a.label}</span>}
          </button>
          {open && (
            <div className="dock-menu" role="menu" aria-label={a.label}>
              <div className="dock-menu-title">{a.label}</div>
              {a.children.length === 0 && <div className="dock-menu-empty">Nothing here yet</div>}
              {a.children.map((c) => (
                <button key={c.id} type="button" role="menuitem" className="dock-menu-item" onClick={() => { setOpenMenu(null); c.run(); }}>
                  {c.icon && <span className="dock-btn-icon"><Icon name={c.icon} /></span>}
                  <span className="dock-menu-label">{c.label}</span>
                  {c.hint && <span className="dock-menu-hint">{c.hint}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      );
    }
    return (
      <button
        key={a.id}
        type="button"
        className={`dock-btn${a.primary ? " dock-btn--primary" : ""}`}
        onClick={a.run}
        aria-label={a.label}
      >
        {a.icon && <span className="dock-btn-icon"><Icon name={a.icon} /></span>}
        <span className="dock-tooltip" role="presentation">{a.label}</span>
      </button>
    );
  };

  return (
    <div ref={rootRef} className="page-dock" role="toolbar" aria-label="Page actions" aria-orientation="vertical">
      {primary && (
        <>
          {renderBtn(primary)}
          <div className="dock-sep" />
        </>
      )}
      {rest.map(renderBtn)}
    </div>
  );
}
