---
name: curata-workflow
description: "List and run workflows stored in your curata instance. Use when asked to 'run a workflow', 'curata-workflow', 'what workflows are available', or 'show me the workflow for X'."
---

# curata-workflow

## Running a workflow

1. Find it: `search_pages` with query matching the workflow name
2. Read it: `read_page` with the workflow's slug
3. Follow it step by step — each workflow is self-documenting

## Listing workflows

Search for pages with "Workflow" in the title:

```
search_pages query: "Workflow"
```

## Seed workflows

curata ships with these workflow pages (seeded on first run):

| Workflow | Slug | Purpose |
|----------|------|---------|
| Implementation Planning | `workflow-implementation-planning` | Build a plan page from discovery to task breakdown |
| Customer Onboarding | `workflow-customer-onboarding` | Create initial page set for a new customer |
| Call Prep & Debrief | `workflow-call-prep-debrief` | Pre-call research + post-call page updates |
| Assessment Builder | `workflow-assessment-builder` | Build current-state security assessments |
| Weekly Highlights | `workflow-weekly-highlights` | Cross-customer highlights for standups |
| Feature Request / Bug | `workflow-feature-request-bug` | File and track feature requests with customer attribution |
| Deal Debrief | `workflow-deal-debrief` | Post-deal learnings capture |
| Semantic Refresh | `workflow-semantic-refresh` | Rebuild hub from external data sources |
| Account Health Report | `workflow-account-health-report` | Generate account health snapshots |

## MCP setup

Requires a curata MCP server configured in `.mcp.json`. See `/curata-plan` for setup instructions.
