"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TEMPLATES, PERSONAS } from "@/lib/templates";

type Step = "template" | "details";

export function NewPageButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("template");
  const [title, setTitle] = useState("");
  const [shell, setShell] = useState("standard");
  const [templateSlug, setTemplateSlug] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function openModal() {
    setOpen(true);
    setStep("template");
    setTitle("");
    setShell("standard");
    setTemplateSlug(null);
    setError("");
  }

  function closeModal() {
    setOpen(false);
  }

  function selectScratch() {
    setTemplateSlug(null);
    setTitle("");
    setStep("details");
  }

  function selectTemplate(slug: string, templateTitle: string) {
    setTemplateSlug(slug);
    setTitle(templateTitle);
    setStep("details");
  }

  function goBack() {
    setStep("template");
    setError("");
  }

  async function create() {
    if (!title.trim()) return;
    setSubmitting(true);
    setError("");

    const body: Record<string, unknown> = { title: title.trim() };
    if (templateSlug) {
      body.templateSlug = templateSlug;
    } else {
      body.shell = shell;
    }

    const res = await fetch("/api/pages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    setSubmitting(false);

    if (!res.ok) {
      setError(data.error || "Failed to create page");
      return;
    }

    setOpen(false);
    router.push(templateSlug ? `/pages/${data.slug}` : `/pages/${data.slug}?edit=1`);
  }

  if (!open) {
    return (
      <button className="new-page-btn" onClick={openModal}>
        + New Page
      </button>
    );
  }

  return (
    <div className="new-page-modal-overlay" onClick={closeModal}>
      <div
        className={`new-page-modal ${step === "template" ? "new-page-modal--wide" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        {step === "template" ? (
          <>
            <div className="new-page-modal-header">New page</div>

            {/* Start from scratch */}
            <button className="new-page-scratch" onClick={selectScratch}>
              <span className="new-page-scratch-icon">+</span>
              <span className="new-page-scratch-text">
                <span className="new-page-scratch-title">Start from scratch</span>
                <span className="new-page-scratch-desc">Blank page with your choice of layout</span>
              </span>
            </button>

            <div className="new-page-template-divider">or use a template</div>

            <div className="new-page-template-list">
              {PERSONAS.map((persona) => {
                const group = TEMPLATES.filter((t) => t.persona === persona);
                return (
                  <div key={persona} className="new-page-template-group">
                    <div className="new-page-template-group-label">{persona}</div>
                    {group.map((t) => (
                      <button
                        key={t.slug}
                        className="new-page-template-card"
                        onClick={() => selectTemplate(t.slug, t.title)}
                      >
                        <span className="new-page-template-card-title">{t.title}</span>
                        <span className="new-page-template-card-desc">{t.description}</span>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>

            <div className="new-page-actions">
              <button className="new-page-cancel" onClick={closeModal}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="new-page-modal-header">
              {templateSlug ? "From template" : "New page"}
            </div>

            {templateSlug && (
              <div className="new-page-template-badge">
                {TEMPLATES.find((t) => t.slug === templateSlug)?.title}
              </div>
            )}

            <div className="new-page-field">
              <label className="new-page-label">Title</label>
              <input
                className="new-page-input"
                autoFocus
                placeholder="e.g. Product Overview"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !submitting) create();
                  if (e.key === "Escape") closeModal();
                }}
              />
            </div>

            {!templateSlug && (
              <div className="new-page-field">
                <label className="new-page-label">Layout</label>
                <div className="new-page-shells">
                  {(["standard", "document", "deck"] as const).map((s) => (
                    <button
                      key={s}
                      className={`new-page-shell ${shell === s ? "new-page-shell--active" : ""}`}
                      onClick={() => setShell(s)}
                    >
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {error && <div className="new-page-error">{error}</div>}

            <div className="new-page-actions">
              <button className="new-page-cancel" onClick={goBack}>
                Back
              </button>
              <button
                className="new-page-submit"
                disabled={!title.trim() || submitting}
                onClick={create}
              >
                {submitting ? "Creating..." : "Create"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
