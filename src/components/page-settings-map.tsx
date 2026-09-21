import Link from "next/link";
import type { PageMapView } from "@/lib/chart";
import { SettingsSection } from "@/components/settings";
import { ChartRows } from "@/components/chart-rows";
import { chartHref } from "@/components/chart-view";
import { AddUnderForm, MakeNodeButton, PageUnderRows } from "@/components/page-map-tab";

/**
 * Content map tab on a page's settings: what this page sits under, and, if
 * this page is a source of truth, what sits under it. Same rows, same
 * verbs, as the map itself.
 */
export function PageSettingsMap({ slug, title, view, nodes, canEdit }: { slug: string; title: string; view: PageMapView; nodes: Array<{ term: string; title: string }>; canEdit: boolean }) {
  return (
    <>
      <SettingsSection
        title="Content sources"
        description="Pages this one relies on for content and wording. When a source changes, this page may have drifted and needs a review."
      >
        <PageUnderRows slug={slug} title={title} under={view.under} canEdit={canEdit} />
        {canEdit && <AddUnderForm slug={slug} nodes={nodes.filter((n) => !view.under.some((u) => u.node.term === n.term))} />}
      </SettingsSection>

      <SettingsSection
        title="Related content"
        description={view.asNode
          ? <>This page is the source of truth for <Link href={chartHref(view.asNode.term)} className="stg-dep-link">{view.asNode.title}</Link>. Change it and everything below needs a look.</>
          : "This page isn't a source of truth for anything yet. Make it a top level item and other content can sit under it."}
      >
        {view.asNode
          ? (view.asNode.children.length === 0
              ? <div className="dash-empty stg-table">Nothing under it yet. <Link href={chartHref(view.asNode.term)} className="stg-dep-link">Add related content on the map.</Link></div>
              : <ChartRows rows={view.asNode.children} term={view.asNode.term} canEdit={canEdit} source={view.asNode.source} />)
          : canEdit && <div className="stg-composer"><MakeNodeButton slug={slug} /></div>}
      </SettingsSection>
    </>
  );
}
