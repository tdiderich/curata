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

## Querying the graph

- `get_vocabulary` — see all terms, sorted by usage. Filter by `kind` or `query` prefix.
- `get_related` — given a `term` or `slug`, find connected pages and shared concepts.
- `get_semantic_map` — full graph topology. Use to find untagged pages or discover patterns.

## Semantic refresh workflow

Run the `curata-semantic-refresh` workflow to backfill concepts on pages that don't have any. It calls `get_semantic_map` to find gaps, reads each untagged page, and writes concepts/links using vocabulary terms.
