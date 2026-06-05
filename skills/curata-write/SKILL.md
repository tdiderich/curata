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

For full component specs, check if your instance has a component reference page, or refer to the curata docs.
