import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AUTH_MODE, resolveOrg } from "@/lib/auth";
import { StoryboardSection } from "@/components/storyboard-section";
import {
  StoryboardSegmentedControl,
  StoryboardFilterChips,
  StoryboardToastTrigger,
} from "@/components/storyboard-interactive";
import { StatusBadge } from "@/components/settings/status-badge";
import { TeamChip } from "@/components/settings/team-chip";

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
            <button className="stg-icon-btn" aria-label="Delete" title="stg-icon-btn (icon-only, kept separate)">
              &#10005;
            </button>
          </StoryboardSection>

          <StoryboardSection
            title="Buttons: marketing (overlay only)"
            description="loop-btn-primary / loop-btn-secondary (hero and pricing CTAs) and mnav-ghost / mnav-solid (floating nav pill) live in curata-app/extensions/src/app/marketing.css, not in this OSS repo, so they can't render correctly on this page. Bigger touch targets and a pill radius are the deliberate reason they stay separate from .btn, not an oversight. See the marketing pages themselves to preview."
          >
            <span className="stg-section-desc" style={{ fontStyle: "italic" }}>
              (overlay-only, not renderable here)
            </span>
          </StoryboardSection>

          <StoryboardSection
            title="Pills: real components"
            description="The actual StatusBadge and TeamChip components (settings/status-badge.tsx, settings/team-chip.tsx), not approximated markup."
          >
            <StatusBadge tone="approval" label="approved" />
            <StatusBadge tone="review" label="in review" />
            <StatusBadge tone="block" label="blocked" />
            <StatusBadge tone="guidance" label="guidance" />
            <StatusBadge tone="topic" label="topic" />
            <StatusBadge tone="vendor" label="vendor" />
            <TeamChip />
          </StoryboardSection>

          <StoryboardSection
            title="Filter chips: kept separate, real interaction"
            description="ci-chip and dash-attention-chip look pill-like but toggle an active/selected state on click, a pill never does. Click them, the state actually changes."
          >
            <StoryboardFilterChips />
          </StoryboardSection>

          <StoryboardSection
            title="Banners"
            description="Row-shaped callouts: tinted box, message + optional action on the right. Not consolidated in this pass (deferred as its own follow-up), cataloged here as-is."
          >
            <div className="members-invite-banner" style={{ maxWidth: 420 }}>
              <span className="members-invite-copy">members-invite-banner: message + CTA</span>
              <button className="btn btn--primary">Action</button>
            </div>
          </StoryboardSection>

          <StoryboardSection
            title="Toast"
            description="Stacked, timed, and dismissible (toast.tsx). The opposite of a pill: transient by design, never a static label. Click to fire a real one."
          >
            <StoryboardToastTrigger />
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
            title="Known duplication: not fixed yet"
            description="Page visibility (private/org/public) is implemented three separate times: VisibilityPicker (dropdown menu, visibility-picker.tsx), VisibilityBadge (click-to-cycle button, page-folder-select.tsx), and PublicToggle (fake switch, public-toggle.tsx, currently unreferenced in any JSX). Same underlying PATCH call, three CSS families. Deliberately excluded from this pass, it's behavioral surgery across three components, not a class rename, and deserves its own focused test pass rather than riding along."
          >
            <span className="stg-section-desc" style={{ fontStyle: "italic" }}>
              (real bug, tracked separately, not demoed here)
            </span>
          </StoryboardSection>
        </div>
      </div>
    </>
  );
}
