import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { PageSettingsDependencies } from "./page-settings-dependencies";
import type { DependentsResult, DependentPage, ExternalDependentRow } from "@/lib/concepts";

const HOUR = 3600 * 1000;
const ago = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();

function page(slug: string, via: string, rel: string, state: "fresh" | "stale" | "never"): DependentPage {
  return {
    slug,
    title: slug.replace(/-/g, " "),
    folderId: null,
    rel,
    via,
    trusted: state !== "never",
    trustedBehind: state === "stale",
    updatedAt: ago(2),
    verifiedAt: state === "never" ? null : state === "stale" ? ago(30 * 24) : ago(3),
    verifiedNote: state === "fresh" && slug.includes("battle") ? "does not quote the price" : null,
    staleAgainstSource: state !== "fresh",
  };
}

function external(url: string, label: string, via: string, state: "fresh" | "stale" | "never", owner?: string): ExternalDependentRow {
  return {
    id: url,
    url,
    host: new URL(url).host.replace(/^www\./, ""),
    label,
    owner: owner ?? null,
    rel: "depends",
    via,
    verifiedAt: state === "never" ? null : state === "fresh" ? ago(5) : ago(40 * 24),
    verifiedNote: state === "fresh" ? "checked the README, still current" : null,
    staleAgainstSource: state !== "fresh",
  };
}

const EMPTY: DependentsResult = {
  page: { slug: "orphan", title: "Orphan page" },
  concepts: [{ term: "misc", kind: "topic", rel: "references" }],
  asserters: [],
  dependents: [],
  instances: [],
  asserterGaps: [],
  external: [],
  summary: { pages: { total: 0, ok: 0, stale: 0, neverVerified: 0 }, external: { total: 0, ok: 0, stale: 0, neverChecked: 0 }, text: "" },
};

const DEPENDS_ONLY: DependentsResult = {
  page: { slug: "sales-cloud-battle-card", title: "Sales cloud battle card" },
  concepts: [
    { term: "feature/gcp-support", kind: "topic", rel: "depends" },
    { term: "pricing/tier-2", kind: "topic", rel: "depends" },
    { term: "cloud-providers", kind: "topic", rel: "references" },
  ],
  asserters: [page("pricing-page", "pricing/tier-2", "asserts", "fresh")],
  dependents: [],
  instances: [],
  asserterGaps: ["feature/gcp-support"],
  external: [],
  summary: { pages: { total: 0, ok: 0, stale: 0, neverVerified: 0 }, external: { total: 0, ok: 0, stale: 0, neverChecked: 0 }, text: "" },
};

const BOTH: DependentsResult = {
  page: { slug: "pricing-page", title: "Pricing" },
  concepts: [
    { term: "pricing/tier-2", kind: "topic", rel: "asserts" },
    { term: "billing/stripe", kind: "vendor", rel: "depends" },
  ],
  asserters: [page("stripe-integration", "billing/stripe", "asserts", "stale")],
  dependents: [
    page("sales-cloud-battle-card", "pricing/tier-2", "depends", "fresh"),
    page("customer-faq", "pricing/tier-2", "depends", "stale"),
    page("acme-pov-plan", "pricing/tier-2", "depends", "never"),
  ],
  instances: [page("acme-pov-roi", "template/pricing-page", "instantiates", "fresh")],
  asserterGaps: [],
  external: [
    external("https://docs.google.com/presentation/d/1QzX/", "Sales deck Q3", "pricing/tier-2", "stale", "Sales enablement"),
    external("https://github.com/mazehq/atlas_universe/blob/main/README.md", "atlas_universe README", "pricing/tier-2", "fresh"),
    external("https://dashboard.stripe.com/prices/price_1Tier2Seat", "Stripe price object", "pricing/tier-2", "never", "Finance"),
  ],
  summary: { pages: { total: 0, ok: 0, stale: 0, neverVerified: 0 }, external: { total: 0, ok: 0, stale: 0, neverChecked: 0 }, text: "" },
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
