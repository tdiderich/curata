# Semantic Tagging Guide

When writing or updating pages, tag the concepts and cross-page links you encounter. This builds a shared knowledge graph that helps discover patterns across customers.

## Quick start

1. Call `get_vocabulary` to see existing terms
2. Read the page with `read_page` — check existing `concepts` and `links`
3. When writing, pass `concepts` and `links` as JSON strings alongside `content`

## Tagging concepts

Pass a `concepts` param (JSON array) to `write_page` or `patch_page`:

```json
[
  { "term": "CrowdStrike", "kind": "vendor", "section": "endpoint-coverage" },
  { "term": "IAM posture gap", "kind": "finding", "section": "critical-gaps" }
]
```

- **term**: The concept name. Will be normalized (lowercased, trimmed) for dedup. Use the display form you'd want others to see.
- **kind**: Free-form category. Suggested values: `vendor`, `tool`, `framework`, `finding`, `activity`, `risk`, `metric`, `process`.
- **section**: Optional. The section heading where this concept appears.

### Rules

- Call `get_vocabulary` first — reuse existing terms instead of creating synonyms
- Tag 3-8 concepts per page. Not every noun — just the ones that matter for cross-page discovery.
- Concepts are additive. Writing new ones doesn't remove old ones.

## Linking pages

Pass a `links` param (JSON array) to `write_page` or `patch_page`:

```json
[
  { "target": "acme-assessment-q1", "rel": "informs", "description": "Q1 findings drive priorities" }
]
```

- **target**: Slug of the linked page. Must exist.
- **rel**: Relationship type. Use: `informs`, `references`, `supersedes`, `conflicts`.
- **description**: Optional. Why this link exists.

### Rules

- Link only when the relationship is clear — don't guess.
- Use `informs` when one page's content shapes another's decisions.
- Use `references` for citations or see-also links.
- Use `supersedes` when a page replaces an older one.
- Use `conflicts` when two pages contain contradictory information.
- Links are replaced, not merged. Whatever you pass in `links` becomes the page's full set, and any edge you leave out is deleted. Pass `[]` to clear every link. Concepts behave the other way round: they are additive.
- Read the page first and keep the links you still want. A write that tags one new link and omits the others drops the others.

## Relations on a tag

Each concept tag carries a `rel`:

- `depends`: the page is wrong if the concept changes. A battle card that lists supported clouds depends on `feature/gcp-support`.
- `asserts`: the page is the source of truth for the concept. The pricing page asserts `pricing/tier-2`. Aim for one asserter per concept.
- `references`: a plain mention. The default when you omit `rel`.
- `instantiates`: system-written. `create_from_template` tags the new page `template/<template-slug>` with this rel, and adds a `PageLink` to the template carrying the template hash and the variables used. That link survives `links` replacement.
- `embeds`: system-written. The scan that runs on every save tags a page `component/<slug>` with this rel for each `type: ref` block (or slugged section) it carries. Delete the ref block and the edge goes on the next save.

Omitting `rel` on a tag the page already has leaves the existing rel alone. Terms may carry one `/` namespace: `feature/gcp-support`, `pricing/tier-2`, `template/pov-roi`.

## The content chart

Curata draws an org chart for content from the edges above plus two free ones. A **node** is any concept with three or more children (or one someone promoted): a template with instances, a component page with embedders, a source page with dependents, external assets put under it. Nobody draws it.

Every child has one color from one rule. Green: checked since the source last moved, or nothing to drift against. Yellow: the source moved since the last check, or it was never checked, or someone left a mismatch note. Red: yellow plus past due, or the source moved twice with no check. Node color is the worst child.

- `get_chart` — no args: every node, ranked by fan-out. `term`: that node's children with `color`, `reason`, `lastCheckedAt`, `owner`, `dueAt`, `alsoUnder` (other nodes the same page or asset sits beneath), `check` (an external's recipe), plus `suggestions`: URLs found in the source's or a child's body that probably belong under it.
- `get_needs_look` — yellow and red only, grouped by node. The review queue for drift.
- `add_to_chart` / `remove_from_chart` — put a page (`slug`) or an external (`url`, `label`, `owner`, `due_at`, `check`) under a node, or take it out. `map_dependencies` is the bulk form: `term`, `asserts`, `depends`, `references` slugs and `external` urls in one call; unknown slugs come back in `missing`.
- `set_scope_item` — owner, label and check recipe on an external (shared by every node it sits under); `due_at` per node when `term` is given.
- `set_chart_node` — `hidden` or `promoted`.
- `rescan_inventory` — re-run the scan over every page.

### How an agent checks an external

An external asset can carry a recipe: `{via, tool, locator, ask}`, where `via` is the MCP server name as the agent's session knows it. `audit` returns every yellow or red external split into `withRecipe` and `humanOnly`. For each recipe item, run the check through that MCP, compare to the node's source page, then `mark_verified url=... term=... status=holds` or `status=needs_change note=...`. Curata never holds credentials or calls an MCP itself. Recipes are suggested by domain (hubspot, google-drive, github, notion, linear, atlassian, zendesk) and saved with `set_scope_item`. A mismatch is yellow with a note, not a new status.

### Inventory

Every save also records every absolute http(s) URL on the page as an `ExternalAsset` (one per normalized URL per org) plus an `ExternalRef` per page. That is the inventory, not scope: nothing goes yellow because a page mentions a URL. It feeds `get_chart`'s suggestions. A default ignore list (slack, giphy, calendly, zoom, loom, linkedin, x) merges with the org's `ignoredDomains`.

### Per-edge primitives

- `get_dependents` — given a `term` or `slug`, one row per edge: dependents, the asserter, instances, externals, each with `verifiedAt` and `staleAgainstSource`.
- `mark_verified` — "looked at it." Records the outcome on one edge (`slug` or `url` plus `term`) or on every edge the page or asset carries (omit `term`), without writing a version. `status` is `holds` (default) or `needs_change`. Optional `note`. Any write to a page verifies every edge it carries and clears notes, and so does `mark_trusted`.

A page that depends on `pricing/tier-2` and on `messaging/tagline` is two edges, checked separately. Edges created by `map_dependencies` or `add_to_chart` start unverified (wiring a page into the chart is not checking it); edges created alongside a write start verified as of that write.

### External dependents

Assets that live outside curata are one asset per normalized URL per org (label, owner), with one edge per concept it is tracked against. `/edit`, `/view`, and share-link query strings collapse to the same asset. The same sales deck tracked against pricing and against the tagline is one asset with two edges, each verified on its own; `external[].alsoDependsOn` lists the other concepts. They show up under their node in `get_chart term=...`, in `get_dependents.external`, and in the page settings Dependencies tab. A freshly attached asset is `never checked` until someone runs `mark_verified` on its url: attaching a deck is not the same as opening it. `get_dependents.summary.text` rolls the whole graph up to one line ("3 pages: 1 ok, 2 stale; 3 external assets: 0 checked, 3 never checked").

- `get_vocabulary` — see all terms, sorted by usage. Filter by `kind` or `query` prefix.
- `get_related` — given a `term` or `slug`, find connected pages and shared concepts.
- `get_semantic_map` — full graph topology. Use to find untagged pages or discover patterns.

Archived pages are left out of `get_related` results, including links that point at them. `list_templates` skips archived templates the same way. Concept usage counts still include archived pages, so a term can report a higher count than the number of pages `get_related` hands back.

## Semantic refresh workflow

Run the `curata-semantic-refresh` workflow to backfill concepts on pages that don't have any. It calls `get_semantic_map` to find gaps, reads each untagged page, and writes concepts/links using vocabulary terms.
