import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

/**
 * The pure-CSS primitive families from the 2026-08-17 consolidation pass.
 * These have no React component of their own, the class IS the API, so the
 * stories render the canonical markup for each.
 */
const meta = {
  title: "Primitives",
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const Buttons: Story = {
  render: () => (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
      <button className="btn btn--primary">Primary</button>
      <button className="btn btn--ghost">Ghost</button>
      <button className="btn btn--danger">Danger</button>
      <button className="btn btn--primary" disabled>
        Disabled
      </button>
      <button className="stg-icon-btn" aria-label="Remove" title="stg-icon-btn: icon-only, deliberately separate">
        &#10005;
      </button>
    </div>
  ),
};

export const Pills: Story = {
  render: () => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      <span className="pill pill--approval">
        <span className="pill-dot" />
        approval tone
      </span>
      <span className="pill pill--review">
        <span className="pill-dot" />
        review tone
      </span>
      <span className="pill pill--block">
        <span className="pill-dot" />
        block tone
      </span>
      <span className="pill pill--guidance">
        <span className="pill-dot" />
        guidance tone
      </span>
      <span className="pill pill--mono pill--team">mono modifier</span>
    </div>
  ),
};

export const FilterChips: Story = {
  render: function FilterChips() {
    const [active, setActive] = useState(true);
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button
          type="button"
          className={`dash-attention-chip${active ? " dash-attention-chip--active" : ""}`}
          onClick={() => setActive((v) => !v)}
        >
          dash-attention-chip (click me)
        </button>
        <button type="button" className="ci-chip">
          <span className="ci-chip-dot" style={{ background: "var(--teal)" }} aria-hidden />
          ci-chip
          <span className="ci-chip-cnt">12</span>
        </button>
      </div>
    );
  },
};

export const PricingCards: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 16 }}>
      <div className="pricing-card" style={{ width: 220 }}>
        <p className="billing-plan-name">Personal</p>
        <p className="billing-plan-price">$0</p>
        <p className="billing-plan-sub">Solo. 128k-token brain.</p>
      </div>
      <div className="pricing-card pricing-card--featured" style={{ width: 220 }}>
        <p className="billing-plan-name">Team</p>
        <p className="billing-plan-price">$5</p>
        <p className="billing-plan-sub">Unlimited teammates. 256k-token brain per seat.</p>
      </div>
    </div>
  ),
};

export const TemplatePickerCards: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 12 }}>
      <button className="template-picker-card" style={{ width: 200 }}>
        <span className="template-picker-card-title">Blank page</span>
        <span className="template-picker-card-desc">Start from nothing</span>
      </button>
      <button className="template-picker-card template-picker-card--creating" style={{ width: 200 }}>
        <span className="template-picker-card-title">Creating…</span>
        <span className="template-picker-card-desc">Active state</span>
      </button>
    </div>
  ),
};

export const Banner: Story = {
  render: () => (
    <div className="members-invite-banner" style={{ maxWidth: 460 }}>
      <span className="members-invite-copy">Banner family: message plus an action on the right.</span>
      <button className="btn btn--primary">Action</button>
    </div>
  ),
};
