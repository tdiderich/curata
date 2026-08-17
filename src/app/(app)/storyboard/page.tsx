import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AUTH_MODE, resolveOrg } from "@/lib/auth";
import { StoryboardSection } from "@/components/storyboard-section";
import { StoryboardSegmentedControl } from "@/components/storyboard-interactive";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Component storyboard" };

// Living catalog of the shared primitives, not a design tool: every class
// here is the same one the app renders with, so this page drifts out of
// sync the moment someone hand-rolls a new button instead of reusing .btn.
// Reference for kz-71e9ca (dead-CSS checker) and kz-c2e97d (unused-
// component checker), both of which check code against what's cataloged
// here.
export default async function StoryboardPage() {
  const ctx = await resolveOrg();
  if (!ctx) redirect(AUTH_MODE === "clerk" ? "/onboarding" : "/sign-in");

  return (
    <>
      <div className="site-bar">
        <Link href="/dashboard" className="site-bar-back">
          &larr; Dashboard
        </Link>
        <span className="site-bar-title">Component storyboard</span>
      </div>
      <div className="dash-root">
        <div className="dash-workspace storyboard-workspace">
          <StoryboardSection
            title="Buttons"
            description="btn / btn--primary / btn--ghost / btn--danger. Every clickable action in the app, settings chrome and marketing CTAs alike, composes from this one family."
          >
            <button className="btn btn--primary">Primary</button>
            <button className="btn btn--ghost">Ghost</button>
            <button className="btn btn--danger">Danger</button>
            <button className="btn btn--primary" disabled>
              Disabled
            </button>
          </StoryboardSection>

          <StoryboardSection
            title="Pills"
            description="pill, with a tone modifier (pill--{tone}) and an optional pill-dot. Status badges, role chips, and tag kinds all render through this one shape."
          >
            <span className="pill pill--approval">
              <span className="pill-dot" />
              approved
            </span>
            <span className="pill pill--review">
              <span className="pill-dot" />
              in review
            </span>
            <span className="pill pill--block">
              <span className="pill-dot" />
              blocked
            </span>
            <span className="pill pill--guidance">
              <span className="pill-dot" />
              guidance
            </span>
            <span className="pill pill--topic pill--mono">topic</span>
            <span className="pill pill--vendor pill--mono">vendor</span>
          </StoryboardSection>

          <StoryboardSection
            title="Segmented control"
            description="The one real component here (settings/segmented-control.tsx), not just a CSS class. Options can carry an optional icon, used below for the colored kind dots."
          >
            <StoryboardSegmentedControl />
          </StoryboardSection>

          <StoryboardSection
            title="Pricing card"
            description="pricing-card, with a --featured modifier for the recommended tier and a --current modifier for the plan an org is already on."
          >
            <div className="pricing-card" style={{ maxWidth: 220 }}>
              <p className="billing-plan-name">Personal</p>
              <p className="billing-plan-price">$0</p>
              <p className="billing-plan-sub">Solo. 128k-token brain.</p>
            </div>
            <div className="pricing-card pricing-card--featured" style={{ maxWidth: 220 }}>
              <p className="billing-plan-name">Team</p>
              <p className="billing-plan-price">$5</p>
              <p className="billing-plan-sub">Unlimited teammates.</p>
            </div>
          </StoryboardSection>

          <StoryboardSection
            title="Template picker card"
            description="template-picker-card, the row style used for both the dashboard's blank/template picker and the new-page dialog's template list."
          >
            <button className="template-picker-card" style={{ maxWidth: 200 }}>
              <span className="template-picker-card-title">Blank page</span>
              <span className="template-picker-card-desc">Start from nothing</span>
            </button>
            <button className="template-picker-card template-picker-card--creating" style={{ maxWidth: 200 }}>
              <span className="template-picker-card-title">Creating…</span>
              <span className="template-picker-card-desc">Active state</span>
            </button>
          </StoryboardSection>

          <StoryboardSection
            title="Kept separate, on purpose"
            description="These look similar to something above but earn their own shape: a filter chip toggles active state on click (a pill never does), and the toast stack is timed and dismissible (a pill never is)."
          >
            <span className="ci-chip">clickable filter (ci-chip)</span>
            <span className="dash-attention-chip">clickable filter (dash-attention-chip)</span>
          </StoryboardSection>
        </div>
      </div>
    </>
  );
}
