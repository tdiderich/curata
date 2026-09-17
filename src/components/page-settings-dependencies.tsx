import Link from "next/link";
import { SettingsSection } from "@/components/settings/settings-section";
import { SettingsTable } from "@/components/settings/settings-table";
import { StatusBadge, type StatusBadgeTone } from "@/components/settings/status-badge";
import type { DependentsResult, DependentPage } from "@/lib/concepts";

interface PageSettingsDependenciesProps {
  data: DependentsResult;
}

const REL_TONE: Record<string, StatusBadgeTone> = {
  depends: "depends",
  asserts: "asserts",
  references: "references",
  instantiates: "instantiates",
};

function relBadge(rel: string) {
  return <StatusBadge tone={REL_TONE[rel] ?? "references"} label={rel} />;
}

function trustBadge(p: Pick<DependentPage, "trusted" | "trustedBehind">) {
  if (!p.trusted) return <StatusBadge tone="untrusted" label="never trusted" />;
  if (p.trustedBehind) return <StatusBadge tone="behind" label="behind" />;
  return <StatusBadge tone="trusted" label="trusted" />;
}

/**
 * Dependencies tab on page settings. Pure presentation: the server component
 * fetches getDependents() and hands the result down, so this renders the
 * same in Storybook as in the app. Depth 1, read-only. Agents set rel on
 * tags; humans read the consequences here.
 */
export function PageSettingsDependencies({ data }: PageSettingsDependenciesProps) {
  const dependsOn = data.concepts.filter((c) => c.rel === "depends");
  const asserts = data.concepts.filter((c) => c.rel === "asserts");
  const assertersByTerm = new Map<string, DependentPage[]>();
  for (const a of data.asserters) {
    const list = assertersByTerm.get(a.via) ?? [];
    list.push(a);
    assertersByTerm.set(a.via, list);
  }
  const downstream = [...data.dependents, ...data.instances];
  const nothingTagged = dependsOn.length === 0 && asserts.length === 0 && downstream.length === 0;

  return (
    <>
      <SettingsSection
        title="Depends on"
        description="Concepts this page is wrong about if they change, and the page that owns the truth for each."
      >
        <SettingsTable
          head={
            <>
              <th className="dash-th dash-th-title" style={{ width: "40%" }}>Concept</th>
              <th className="dash-th">Asserted by</th>
              <th className="dash-th">Rel</th>
            </>
          }
          empty={
            dependsOn.length === 0
              ? nothingTagged
                ? "No dependencies tagged. Tag a concept with rel depends or asserts to see it here."
                : "This page doesn't depend on any concept."
              : undefined
          }
        >
          {dependsOn.map((c) => {
            const owners = assertersByTerm.get(c.term) ?? [];
            return (
              <tr key={c.term} className="dash-row">
                <td className="dash-td dash-td-title">{c.term}</td>
                <td className="dash-td">
                  {owners.length === 0 ? (
                    <span className="stg-pcount">no source of truth</span>
                  ) : (
                    <span className="stg-dep-owners">
                      {owners.map((o) => (
                        <Link key={o.slug} href={`/pages/${o.slug}`} className="stg-dep-link">
                          {o.title || o.slug}
                        </Link>
                      ))}
                    </span>
                  )}
                </td>
                <td className="dash-td">{relBadge(c.rel)}</td>
              </tr>
            );
          })}
        </SettingsTable>
      </SettingsSection>

      <SettingsSection
        title="Depended on by"
        description="Pages that go stale when this page changes: dependents of what it asserts, and pages built from it as a template."
      >
        <SettingsTable
          head={
            <>
              <th className="dash-th dash-th-title" style={{ width: "40%" }}>Page</th>
              <th className="dash-th">Via</th>
              <th className="dash-th">Rel</th>
              <th className="dash-th">Trust</th>
            </>
          }
          empty={
            downstream.length === 0
              ? asserts.length === 0
                ? "Nothing depends on this page. Tag a concept with rel asserts to make this page its source of truth."
                : `This page asserts ${asserts.map((a) => a.term).join(", ")}. No page depends on it yet.`
              : undefined
          }
        >
          {downstream.map((d) => (
            <tr key={`${d.slug}:${d.via}:${d.rel}`} className="dash-row">
              <td className="dash-td dash-td-title">
                <Link href={`/pages/${d.slug}`} className="stg-dep-link">
                  {d.title || d.slug}
                </Link>
              </td>
              <td className="dash-td">{d.via}</td>
              <td className="dash-td">{relBadge(d.rel)}</td>
              <td className="dash-td">{trustBadge(d)}</td>
            </tr>
          ))}
        </SettingsTable>
      </SettingsSection>
    </>
  );
}
