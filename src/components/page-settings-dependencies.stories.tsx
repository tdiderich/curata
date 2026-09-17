import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { PageSettingsDependencies } from "./page-settings-dependencies";
import type { DependentsResult, DependentPage } from "@/lib/concepts";

function page(slug: string, via: string, rel: string, trust: "trusted" | "behind" | "never"): DependentPage {
  return {
    slug,
    title: slug.replace(/-/g, " "),
    folderId: null,
    rel,
    via,
    trusted: trust !== "never",
    trustedBehind: trust === "behind",
    updatedAt: "2026-09-17T12:00:00.000Z",
  };
}

const EMPTY: DependentsResult = {
  page: { slug: "orphan", title: "Orphan page" },
  concepts: [{ term: "misc", kind: "topic", rel: "references" }],
  asserters: [],
  dependents: [],
  instances: [],
  asserterGaps: [],
};

const DEPENDS_ONLY: DependentsResult = {
  page: { slug: "sales-cloud-battle-card", title: "Sales cloud battle card" },
  concepts: [
    { term: "feature/gcp-support", kind: "topic", rel: "depends" },
    { term: "pricing/tier-2", kind: "topic", rel: "depends" },
    { term: "cloud-providers", kind: "topic", rel: "references" },
  ],
  asserters: [page("pricing-page", "pricing/tier-2", "asserts", "trusted")],
  dependents: [],
  instances: [],
  asserterGaps: ["feature/gcp-support"],
};

const BOTH: DependentsResult = {
  page: { slug: "pricing-page", title: "Pricing" },
  concepts: [
    { term: "pricing/tier-2", kind: "topic", rel: "asserts" },
    { term: "billing/stripe", kind: "vendor", rel: "depends" },
  ],
  asserters: [page("stripe-integration", "billing/stripe", "asserts", "behind")],
  dependents: [
    page("sales-cloud-battle-card", "pricing/tier-2", "depends", "trusted"),
    page("customer-faq", "pricing/tier-2", "depends", "behind"),
    page("acme-pov-plan", "pricing/tier-2", "depends", "never"),
  ],
  instances: [page("acme-pov-roi", "template/pricing-page", "instantiates", "trusted")],
  asserterGaps: [],
};

const meta = {
  title: "Settings/PageSettingsDependencies",
  component: PageSettingsDependencies,
  args: { data: BOTH },
} satisfies Meta<typeof PageSettingsDependencies>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = { args: { data: EMPTY } };
export const DependsOnly: Story = { args: { data: DEPENDS_ONLY } };
export const Both: Story = {};
