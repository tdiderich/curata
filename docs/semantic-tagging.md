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

Omitting `rel` on a tag the page already has leaves the existing rel alone. Terms may carry one `/` namespace: `feature/gcp-support`, `pricing/tier-2`, `template/pov-roi`.

## Querying the graph

- `get_dependents` — given a `term` or `slug`, the directional view: pages that depend on it, the page that asserts it, pages built from it, and external assets attached to it. Every row carries `verifiedAt` and `staleAgainstSource` (the source of truth moved after that row was last verified). Call before changing something, and after, to see what still has not been looked at.
- `map_dependencies` — build the graph around one concept in one call: `term`, `asserts` (slugs that own the truth), `depends` (slugs that go stale), `references`, `external` (`[{url, label?, owner?, rel?}]` for assets outside curata), and `includes` (terms of other maps to reuse as sub-maps). Additive except `removeIncludes`; unknown slugs come back in `missing`, unknown include terms in `missingIncludes`, neither fails the call.

### Sub-maps

A map can include another map's own `depends`/`external` as a reusable group: `includes: ["group/sales-enablement"]` pulls that group's rows into the parent's `get_dependents` response, tagged with `group`. Verification of a shared row is per (edge, viewing map): checking it while looking at one parent never marks it checked for another parent that also includes the group, or for the group's own direct view. `mark_verified` takes an optional `context` (the map you're currently looking at) alongside `term` (the edge's own concept) to scope the write; passing the same value for both, or omitting `context`, writes the ordinary un-scoped record. A cycle (an include chain that would let a map include itself) is refused at write time.
- `mark_verified` — "looked at it." Records the outcome on one edge (`slug` or `url` plus `term`) or on every edge the page or asset carries (omit `term`), without writing a version. `status` is `holds` (default, still right) or `needs_change` (looked, it is wrong, reads as "needs update" until a write or a later holds). Optional `note` says what you found. Any write to a page verifies every edge it carries and clears notes, and so does `mark_trusted`.

### Verification is per edge

A page that depends on `pricing/tier-2` and on `messaging/tagline` is two edges, checked separately. Verifying the one-pager for the pricing change does not say anything about the tagline. `get_dependents` returns one row per edge with its own `verifiedAt`, `verifiedNote`, `needsChange`, and `staleAgainstSource`. Edges created by `map_dependencies` start unverified (wiring a page into a graph is not checking it); edges created alongside a write start verified as of that write.

### External dependents

Assets that live outside curata are one asset per normalized URL per org (label, owner), with one edge per concept it is tracked against. `/edit`, `/view`, and share-link query strings collapse to the same asset. The same sales deck tracked against pricing and against the tagline is one asset with two edges, each verified on its own; `external[].alsoDependsOn` lists the other concepts. They show up inline in `get_dependents.external` and in the page settings Dependencies tab with the site favicon. A freshly attached asset is `never checked` until someone runs `mark_verified` on its url: attaching a deck is not the same as opening it. `get_dependents.summary.text` rolls the whole graph up to one line ("3 pages: 1 ok, 2 stale; 3 external assets: 0 checked, 3 never checked").

- `get_vocabulary` — see all terms, sorted by usage. Filter by `kind` or `query` prefix.
- `get_related` — given a `term` or `slug`, find connected pages and shared concepts.
- `get_semantic_map` — full graph topology. Use to find untagged pages or discover patterns.

Archived pages are left out of `get_related` results, including links that point at them. `list_templates` skips archived templates the same way. Concept usage counts still include archived pages, so a term can report a higher count than the number of pages `get_related` hands back.

## Semantic refresh workflow

Run the `curata-semantic-refresh` workflow to backfill concepts on pages that don't have any. It calls `get_semantic_map` to find gaps, reads each untagged page, and writes concepts/links using vocabulary terms.
