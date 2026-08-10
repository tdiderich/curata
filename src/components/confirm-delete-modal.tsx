"use client";

import { useState } from "react";
import { createPortal } from "react-dom";

// Shared delete confirmation modal. Pass `confirmValue` to require typing an
// exact value before the button enables (a folder name, a delete count) —
// the extra friction for something big/irreversible. Omit it for a standard
// single-item delete: same look, just Cancel/Delete, no typing required.
export function ConfirmDeleteModal({
  title,
  confirmValue = null,
  confirmPrompt,
  confirmButtonLabel,
  busyLabel,
  busy,
  onCancel,
  onConfirm,
  children,
}: {
  title: React.ReactNode;
  confirmValue?: string | null;
  confirmPrompt?: React.ReactNode;
  confirmButtonLabel: string;
  busyLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  children?: React.ReactNode;
}) {
  const [confirmText, setConfirmText] = useState("");
  const requiresInput = confirmValue !== null;
  const matches = !requiresInput || confirmText === confirmValue;

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="agent-overlay" onClick={onCancel}>
      <div
        className="agent-modal confirm-delete-modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && !requiresInput) onConfirm();
        }}
      >
        <div className="agent-modal-header">
          <span className="agent-modal-title">{title}</span>
          <button className="agent-modal-close" onClick={onCancel} aria-label="Cancel">&times;</button>
        </div>
        <div className="agent-step">
          {children}
          {requiresInput && (
            <>
              <label className="confirm-delete-label" htmlFor="confirm-delete-input">{confirmPrompt}</label>
              <input
                id="confirm-delete-input"
                className="confirm-delete-input"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && confirmText === confirmValue) onConfirm();
                }}
                autoFocus
                disabled={busy}
              />
            </>
          )}
          <div className="confirm-delete-actions">
            <button className="cleanup-btn" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button
              className="cleanup-btn cleanup-btn--danger"
              onClick={onConfirm}
              disabled={busy || !matches}
              autoFocus={!requiresInput}
            >
              {busy ? busyLabel : confirmButtonLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
