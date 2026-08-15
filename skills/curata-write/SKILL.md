---
name: curata-write
description: "Create and update pages in your curata instance. Use when asked to 'write to curata', 'create a page', 'update a page', 'annotate', or 'save this to curata'."
---

# curata-write

## Tools

| Tool | Use for |
|------|---------|
| `write_page` | Create or update a page (pass slug + YAML content) |
| `create_page` | Create new page (fails if slug exists) |
| `annotate_page` | Add a comment/annotation to an existing page |

## Page format

Content is YAML:

```yaml
title: "Page Title"
shell: standard
components:
  - type: section
    heading: "Section Name"
    components:
      - type: markdown
        body: |
          Content here.
```

## Common components

| Component | Purpose |
|-----------|---------|
| `split_compare` | Before/after comparison with stats |
| `tree` | Task lists with status tracking |
| `table` | Structured data with columns/rows |
| `callout` | Highlighted info, warnings, errors |
| `steps` | Numbered step-by-step instructions |
| `tabs` | Tabbed content sections |
| `code` | Code blocks with language highlighting |
| `definition_list` | Term/definition pairs |
| `card_grid` | Grid of linked cards |
| `ref` | Embeds another page's components by slug, see Shared components below |

For full component specs, check if your instance has a component reference page, or refer to the curata docs.

## Shared components

If the same block, such as a roadmap or a pricing table or a support contact list,
needs to appear on more than one page and stay in sync, write it once as its own
page with `pageType: component`, then embed it elsewhere:

```yaml
- type: ref
  component: current-roadmap
```

At read time the ref expands to the source page's components. Approving a new
version of the source page (via `mark_trusted`) updates every page that embeds
it, with no edit needed on the consuming pages. To change the content, call
`patch_page` or `write_page` on the source page's own slug. A page that only
embeds a ref has nothing else to change, since its stored content is just the
ref block.

Use a normal page when content only ever lives in one place. Use a `pageType:
component` page when several pages need the same block to update together.
