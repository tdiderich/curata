import Link from "next/link";
import { SettingsSection } from "@/components/settings/settings-section";
import { SettingsTable } from "@/components/settings/settings-table";
import type { DependentsResult, DependentPage } from "@/lib/concepts";
import { DependencyVerifyButton } from "@/components/dependency-verify-button";
import { AddDependencyForm, RemoveDependencyButton } from "@/components/dependency-add-remove";
import { relBadge, verifiedCell, noteCell, externalLink, termLink } from "@/components/dependency-cells";

interface PageSettingsDependenciesProps {
  data: DependentsResult;
  pageId: string;
  canEdit: boolean;
}

/**
 * Dependencies tab on page settings. Pure presentation: the server component
 * fetches getDependents() and hands the result down, so this renders the
 * same in Storybook as in the app. Depth 1. Agents set rel on tags; humans
 * read the consequences here and click Verify when a row still holds.
 */
export function PageSettingsDependencies({ data, pageId, canEdit }: PageSettingsDependenciesProps) {
  const dependsOn = data.concepts.filter((c) => c.rel === "depends");
  const asserts = data.concepts.filter((c) => c.rel === "asserts");
  const assertersByTerm = new Map<string, DependentPage[]>();
  for (const a of data.asserters) {
    const list = assertersByTerm.get(a.via) ?? [];
    list.push(a);
    assertersByTerm.set(a.via, list);
  }
  // One row per edge: a page that depends on two concepts is verified for
  // each separately, so each gets its own line and its own Verify.
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
              {canEdit && <th className="dash-th stg-th-right">&nbsp;</th>}
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
                <td className="dash-td dash-td-title">{termLink(c.term)}</td>
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
                {canEdit && (
                  <td className="dash-td stg-td-right">
                    <RemoveDependencyButton pageId={pageId} term={c.term} />
                  </td>
                )}
              </tr>
            );
          })}
        </SettingsTable>
        {canEdit && <div className="stg-composer"><AddDependencyForm pageId={pageId} /></div>}
      </SettingsSection>

      <SettingsSection
        title="Depended on by"
        description="Pages that go stale when this page changes: dependents of what it asserts, and pages built from it as a template."
      >
        <SettingsTable
          head={
            <>
              <th className="dash-th dash-th-title" style={{ width: "30%" }}>Page</th>
              <th className="dash-th">Via</th>
              <th className="dash-th">Rel</th>
              <th className="dash-th">Last verified</th>
              <th className="dash-th">Verification note</th>
            </>
          }
          empty={
            downstream.length === 0 && data.external.length === 0
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
              <td className="dash-td">{termLink(d.via)}</td>
              <td className="dash-td">{relBadge(d.rel)}</td>
              <td className="dash-td">
                <span className="stg-dep-verify-cell">
                  {verifiedCell(d)}
                  <DependencyVerifyButton slug={d.slug} term={d.via} label={d.staleAgainstSource || !d.verifiedAt ? "Verify" : "Re-verify"} />
                </span>
              </td>
              <td className="dash-td">{noteCell(d.verifiedNote)}</td>
            </tr>
          ))}
          {data.external.map((e) => (
            <tr key={`ext:${e.id}`} className="dash-row">
              <td className="dash-td dash-td-title">
                {externalLink(e)}
                {e.owner && <span className="stg-dep-owner">{e.owner}</span>}
              </td>
              <td className="dash-td" title={e.alsoDependsOn.length ? `Also tracked against ${e.alsoDependsOn.join(", ")}` : undefined}>
                {termLink(e.via)}
                {e.alsoDependsOn.length > 0 && <span className="stg-dep-more"> +{e.alsoDependsOn.length}</span>}
              </td>
              <td className="dash-td">{relBadge(e.rel)}</td>
              <td className="dash-td">
                <span className="stg-dep-verify-cell">
                  {verifiedCell(e, "external")}
                  <DependencyVerifyButton url={e.url} term={e.via} label={e.verifiedAt ? "Re-verify" : "Verify"} />
                </span>
              </td>
              <td className="dash-td">{noteCell(e.verifiedNote)}</td>
            </tr>
          ))}
        </SettingsTable>
      </SettingsSection>
    </>
  );
}
