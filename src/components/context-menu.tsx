"use client";

import { useEffect, useMemo, useRef } from "react";

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
  divider?: boolean;
  onClick: () => void;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  anchorEl: HTMLElement | null;
  open: boolean;
  onClose: () => void;
}

export function ContextMenu({ items, anchorEl, open, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  const pos = useMemo(() => {
    if (!open || !anchorEl) return { top: 0, left: 0 };
    const rect = anchorEl.getBoundingClientRect();
    let top = rect.bottom + 4;
    let left = rect.right - 160;
    if (left < 8) left = 8;
    if (top + 160 > window.innerHeight) top = rect.top - 160;
    return { top, left };
  }, [open, anchorEl]);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={menuRef}
      className="ctx-menu"
      style={{ top: pos.top, left: pos.left }}
    >
      {items.map((item, i) => {
        if (item.divider) {
          return <div key={i} className="ctx-menu-sep" />;
        }
        return (
          <button
            key={i}
            className={`ctx-menu-item${item.danger ? " ctx-menu-item--danger" : ""}`}
            onClick={() => { item.onClick(); onClose(); }}
          >
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
