"use client";

import { useEffect, useState } from "react";

export type ToastKind = "success" | "error" | "info";

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

type Listener = (toasts: ToastItem[]) => void;

// Module-level store so any call site (components, async handlers) can fire a
// toast without provider plumbing. The Toaster component subscribes and renders.
let nextId = 1;
let items: ToastItem[] = [];
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l([...items]);
}

function dismiss(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

function push(kind: ToastKind, message: string) {
  const id = nextId++;
  // Cap the stack at 4 — older toasts drop first.
  items = [...items.slice(-3), { id, kind, message }];
  emit();
  const ttl = kind === "error" ? 6000 : 4000;
  setTimeout(() => dismiss(id), ttl);
}

export const toast = {
  success: (message: string) => push("success", message),
  error: (message: string) => push("error", message),
  info: (message: string) => push("info", message),
};

export function Toaster() {
  const [list, setList] = useState<ToastItem[]>([]);

  useEffect(() => {
    const l: Listener = setList;
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  if (list.length === 0) return null;

  return (
    <div className="toast-stack" aria-label="Notifications">
      {list.map((t) => (
        <div
          key={t.id}
          className={`toast toast--${t.kind}`}
          role={t.kind === "error" ? "alert" : "status"}
        >
          <span className="toast-message">{t.message}</span>
          <button
            className="toast-dismiss"
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss notification"
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}
