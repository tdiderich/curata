import Link from "next/link";
import { SettingsSection } from "@/components/settings/settings-section";
import { SettingsTable } from "@/components/settings/settings-table";
import { StatusBadge, type StatusBadgeTone } from "@/components/settings/status-badge";
import type { DependentsResult, DependentPage, ExternalDependentRow } from "@/lib/concepts";
import { DependencyVerifyButton } from "@/components/dependency-verify-button";

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

function relativeTime(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 60) return `${d}d ago`;
  return `${Math.round(d / 30)}mo ago`;
}

/**
 * "Last verified" cell. Trust is a governance pointer most orgs never set;
 * verification is the thing a human actually does when they look at a page
 * after the source of truth moved. Stale = source changed since then.
 */
function noteCell(note: string | null) {
  if (!note) return <span className="stg-dep-note stg-dep-note--empty">–</span>;
  return <span className="stg-dep-note" title={note}>{note}</span>;
}

function verifiedCell(p: Pick<DependentPage, "verifiedAt" | "staleAgainstSource" | "needsChange">, kind: "page" | "external" = "page") {
  if (p.needsChange && p.verifiedAt) {
    return (
      <span className="stg-dep-verified">
        <StatusBadge tone="needs-change" label="needs update" />
        <span className="stg-dep-when">{relativeTime(p.verifiedAt)}</span>
      </span>
    );
  }
  if (!p.verifiedAt) {
    return <StatusBadge tone="untrusted" label={kind === "external" ? "never checked" : "never verified"} />;
  }
  if (p.staleAgainstSource) {
    return (
      <span className="stg-dep-verified">
        <StatusBadge tone="behind" label="source changed" />
        <span className="stg-dep-when">{relativeTime(p.verifiedAt)}</span>
      </span>
    );
  }
  return (
    <span className="stg-dep-verified">
      <StatusBadge tone="trusted" label="verified" />
      <span className="stg-dep-when">{relativeTime(p.verifiedAt)}</span>
    </span>
  );
}

function externalLink(e: ExternalDependentRow) {
  return (
    <a href={e.url} target="_blank" rel="noopener noreferrer" className="stg-dep-link stg-dep-ext" title={`Opens ${e.host} in a new tab`}>
      <img
        src={`https://www.google.com/s2/favicons?sz=32&domain=${encodeURIComponent(e.host)}`}
        alt=""
        width={13}
        height={13}
        className="stg-dep-favicon"
      />
      {e.label}
      <span aria-hidden className="stg-dep-arrow">↗</span>
    </a>
  );
}

/**
 * Dependencies tab on page settings. Pure presentation: the server component
 * fetches getDependents() and hands the result down, so this renders the
 * same in Storybook as in the app. Depth 1. Agents set rel on tags; humans
 * read the consequences here and click Verify when a row still holds.
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
              <td className="dash-td">{d.via}</td>
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
                {e.via}
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
