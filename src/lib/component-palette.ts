export interface PaletteEntry {
  type: string;
  label: string;
  description: string;
  group: string;
  stub: string;
  /** When true, AddComponentButton shows a page search flow instead of inserting the stub. */
  mirror?: boolean;
}

export const PALETTE: PaletteEntry[] = [
  // --- Text ---
  {
    type: "markdown",
    label: "Markdown",
    description: "Rich text with headings, lists, links, and inline formatting",
    group: "Text",
    stub: `- type: markdown
  body: "Your content here."`,
  },
  {
    type: "header",
    label: "Header",
    description: "Page or section heading with optional subtitle and eyebrow",
    group: "Text",
    stub: `- type: header
  title: Heading
  subtitle: Optional subtitle`,
  },
  {
    type: "callout",
    label: "Callout",
    description: "Highlighted box for tips, warnings, or important notes",
    group: "Text",
    stub: `- type: callout
  variant: info
  title: Note
  body: "Important information here."`,
  },
  {
    type: "blockquote",
    label: "Blockquote",
    description: "Quoted text with optional attribution",
    group: "Text",
    stub: `- type: blockquote
  body: "Quoted text here."
  attribution: Source`,
  },
  {
    type: "code",
    label: "Code",
    description: "Syntax-highlighted code block",
    group: "Text",
    stub: `- type: code
  language: typescript
  code: |
    console.log("hello");`,
  },
  {
    type: "aside",
    label: "Aside",
    description: "Margin note or supplementary context",
    group: "Text",
    stub: `- type: aside
  body: "Additional context here."`,
  },
  // --- Data ---
  {
    type: "chart",
    label: "Chart",
    description: "Bar, pie, line, or area chart with data points or series",
    group: "Data",
    stub: `- type: chart
  title: Chart Title
  kind: bar
  data:
    - label: A
      value: 40
    - label: B
      value: 60`,
  },
  {
    type: "chart_group",
    label: "Chart Group",
    description: "Multiple charts side by side in a row",
    group: "Data",
    stub: `- type: chart_group
  title: Comparison
  columns: 2
  components:
    - type: chart
      kind: bar
      data:
        - label: A
          value: 40
    - type: chart
      kind: pie
      data:
        - label: X
          value: 70`,
  },
  {
    type: "stat_grid",
    label: "Stat Grid",
    description: "Grid of key metrics with labels, values, and optional colors",
    group: "Data",
    stub: `- type: stat_grid
  columns: 3
  stats:
    - label: Users
      value: "1,234"
    - label: Revenue
      value: "$45k"
    - label: Growth
      value: "+12%"
      color: green`,
  },
  {
    type: "gauge",
    label: "Gauge",
    description: "Donut chart showing progress toward a maximum",
    group: "Data",
    stub: `- type: gauge
  title: Score
  max: 100
  items:
    - label: Complete
      value: 72
      color: green`,
  },
  {
    type: "progress_bar",
    label: "Progress Bar",
    description: "Horizontal bar showing completion toward a target",
    group: "Data",
    stub: `- type: progress_bar
  label: Migration
  value: 65
  target: 100
  color: teal`,
  },
  {
    type: "sankey",
    label: "Sankey",
    description: "Flow diagram showing quantities between stages",
    group: "Data",
    stub: `- type: sankey
  title: Flow
  flows:
    - from: Source
      to: Target A
      value: 30
    - from: Source
      to: Target B
      value: 20`,
  },
  {
    type: "radar",
    label: "Radar",
    description: "Multi-axis comparison chart with overlaid curves",
    group: "Data",
    stub: `- type: radar
  title: Comparison
  axes: [Speed, Quality, Cost, Scale, Support]
  max: 10
  curves:
    - label: Current
      values: [7, 8, 5, 6, 9]
      color: teal`,
  },
  {
    type: "quadrant",
    label: "Quadrant",
    description: "Two-axis plot with labeled quadrants for prioritization",
    group: "Data",
    stub: `- type: quadrant
  title: Priority Matrix
  x_axis: Effort
  y_axis: Impact
  quadrants: [Quick Win, Big Bet, Fill-In, Avoid]
  points:
    - label: Item A
      x: 20
      y: 80
      color: green`,
  },
  {
    type: "venn",
    label: "Venn",
    description: "Overlapping sets showing shared areas between groups",
    group: "Data",
    stub: `- type: venn
  title: Overlap
  sets:
    - label: Group A
      color: teal
    - label: Group B
      color: green
  overlaps:
    - sets: [0, 1]
      label: Shared`,
  },
  {
    type: "graph",
    label: "Graph",
    description: "Node-and-edge concept map or relationship diagram",
    group: "Data",
    stub: `- type: graph
  title: Connections
  nodes:
    - id: a
      label: Node A
      color: teal
    - id: b
      label: Node B
      color: green
  edges:
    - from: a
      to: b
      label: relates`,
  },
  {
    type: "table",
    label: "Table",
    description: "Sortable, filterable data table with typed columns",
    group: "Data",
    stub: `- type: table
  columns:
    - key: name
      label: Name
    - key: status
      label: Status
  rows:
    - name: Item 1
      status: Active`,
  },
  // --- Structure ---
  {
    type: "section",
    label: "Section",
    description: "Group components under a heading with optional eyebrow",
    group: "Structure",
    stub: `- type: section
  heading: Section Title
  components:
    - type: markdown
      body: "Content here."`,
  },
  {
    type: "section",
    label: "Mirror Page",
    description: "Embed another page's content as a live mirror - updates when the source page changes",
    group: "Structure",
    stub: `- type: section
  heading: Section Title
  slug: page-slug-here`,
    mirror: true,
  },
  {
    type: "ref",
    label: "Shared Component",
    description: "Embed a component page's content by reference - updates when the source changes",
    group: "Structure",
    stub: `- type: ref
  component: page-slug-here`,
  },
  {
    type: "accordion",
    label: "Accordion",
    description: "Collapsible sections for optional detail",
    group: "Structure",
    stub: `- type: accordion
  items:
    - title: First item
      body: "Detail here."
    - title: Second item
      body: "More detail."`,
  },
  {
    type: "tabs",
    label: "Tabs",
    description: "Tabbed content panels for mutually exclusive views",
    group: "Structure",
    stub: `- type: tabs
  tabs:
    - label: Tab 1
      components:
        - type: markdown
          body: "First tab content."
    - label: Tab 2
      components:
        - type: markdown
          body: "Second tab content."`,
  },
  {
    type: "columns",
    label: "Columns",
    description: "Side-by-side content in two or more columns",
    group: "Structure",
    stub: `- type: columns
  columns:
    - - type: markdown
        body: "Left column."
    - - type: markdown
        body: "Right column."`,
  },
  {
    type: "steps",
    label: "Steps",
    description: "Ordered or unordered list with titles and detail",
    group: "Structure",
    stub: `- type: steps
  numbered: true
  items:
    - title: Step one
      detail: "Do this first."
    - title: Step two
      detail: "Then this."`,
  },
  {
    type: "card_grid",
    label: "Card Grid",
    description: "Visual grid of cards with titles, bodies, and badges",
    group: "Structure",
    stub: `- type: card_grid
  cards:
    - title: Card A
      body: "Description."
    - title: Card B
      body: "Description."`,
  },
  {
    type: "org_chart",
    label: "Org Chart",
    description: "Hierarchical people chart with titles and reports-to",
    group: "Structure",
    stub: `- type: org_chart
  title: Team
  people:
    - name: Alex Kim
      title: Director
    - name: Sam Lee
      title: Manager
      reports_to: Alex Kim`,
  },
  {
    type: "tree",
    label: "Tree",
    description: "Collapsible hierarchy with status colors and notes",
    group: "Structure",
    stub: `- type: tree
  nodes:
    - label: Root
      children:
        - label: Branch A
        - label: Branch B`,
  },
  {
    type: "architecture",
    label: "Architecture",
    description: "System diagram with labeled nodes and connections",
    group: "Structure",
    stub: `- type: architecture
  title: System
  direction: left_to_right
  nodes:
    - id: a
      label: Service A
      color: teal
    - id: b
      label: Service B
      color: green
  connections:
    - from: a
      to: b
      label: API`,
  },
  {
    type: "pipeline",
    label: "Pipeline",
    description: "Stage flow with inputs, processing stages, and outputs",
    group: "Structure",
    stub: `- type: pipeline
  title: Pipeline
  inputs:
    - label: Input
      detail: "Source"
  stages:
    - label: Process
      detail: "Transform"
  outputs:
    - label: Output
      detail: "Result"
      color: green`,
  },
  {
    type: "role_map",
    label: "Role Map",
    description: "Who owns what with authority tables",
    group: "Structure",
    stub: `- type: role_map
  title: Ownership`,
  },
  // --- Sequence ---
  {
    type: "event_timeline",
    label: "Event Timeline",
    description: "Chronological events with severity, source, and detail",
    group: "Sequence",
    stub: `- type: event_timeline
  events:
    - title: Event occurred
      date: "2026-01-15"
      severity: info
      summary: "Description of what happened."`,
  },
  {
    type: "timeline",
    label: "Timeline",
    description: "Simple status timeline with dates and colors",
    group: "Sequence",
    stub: `- type: timeline
  items:
    - label: Milestone A
      date: "2026-01-01"
      status: done
    - label: Milestone B
      date: "2026-03-01"
      status: active`,
  },
  {
    type: "before_after",
    label: "Before / After",
    description: "Side-by-side comparison of old vs new state",
    group: "Sequence",
    stub: `- type: before_after
  before_label: Before
  after_label: After
  items:
    - title: Comparison
      before: "Old way."
      after: "New way."`,
  },
  {
    type: "priority_queue",
    label: "Priority Queue",
    description: "Grouped items by priority with status tracking",
    group: "Sequence",
    stub: `- type: priority_queue
  title: Backlog
  items:
    - title: Task A
      priority: now
      status: active
    - title: Task B
      priority: next
      status: planned`,
  },
  // --- Layout ---
  {
    type: "hero_banner",
    label: "Hero Banner",
    description: "Full-width header with title, subtitle, and action buttons",
    group: "Layout",
    stub: `- type: hero_banner
  title: Welcome
  subtitle: Get started here.
  buttons:
    - label: Get Started
      href: "#"`,
  },
  {
    type: "image",
    label: "Image",
    description: "Image with alt text, caption, and alignment",
    group: "Layout",
    stub: `- type: image
  src: /placeholder.png
  alt: Description
  caption: Image caption`,
  },
  {
    type: "divider",
    label: "Divider",
    description: "Horizontal rule with optional label",
    group: "Layout",
    stub: `- type: divider
  label: Section Break`,
  },
  {
    type: "split_compare",
    label: "Split Compare",
    description: "Two panels compared side by side with stats",
    group: "Layout",
    stub: `- type: split_compare
  left:
    title: Option A
    stats:
      - label: Score
        value: "85"
  right:
    title: Option B
    stats:
      - label: Score
        value: "92"`,
  },
  {
    type: "empty_state",
    label: "Empty State",
    description: "Placeholder for pages or sections with no content yet",
    group: "Layout",
    stub: `- type: empty_state
  title: Nothing here yet
  body: "Get started by adding content."
  icon: inbox`,
  },
  {
    type: "embed",
    label: "Embed",
    description: "Iframe embed for external content",
    group: "Layout",
    stub: `- type: embed
  src: https://example.com
  title: Embedded content
  aspect: "16:9"`,
  },
  {
    type: "resources",
    label: "Resources",
    description: "List of links with descriptions",
    group: "Layout",
    stub: `- type: resources
  items:
    - title: Documentation
      href: "#"
      description: "Full reference docs."`,
  },
  // --- Interactive ---
  {
    type: "selectable_grid",
    label: "Selectable Grid",
    description: "Grid of selectable cards with interaction tracking",
    group: "Interactive",
    stub: `- type: selectable_grid
  cards:
    - title: Option A
      body: "Choose this."
    - title: Option B
      body: "Or this."`,
  },
  {
    type: "button_group",
    label: "Button Group",
    description: "Row of action buttons with links",
    group: "Interactive",
    stub: `- type: button_group
  buttons:
    - label: Primary
      href: "#"
    - label: Secondary
      href: "#"`,
  },
  // --- Meta ---
  {
    type: "badge",
    label: "Badge",
    description: "Inline colored label",
    group: "Meta",
    stub: `- type: badge
  label: Status
  color: green`,
  },
  {
    type: "tag",
    label: "Tag",
    description: "Small colored tag for categorization",
    group: "Meta",
    stub: `- type: tag
  label: Category
  color: teal`,
  },
  {
    type: "status",
    label: "Status",
    description: "Status indicator with dot and label",
    group: "Meta",
    stub: `- type: status
  label: Active
  color: green`,
  },
  {
    type: "icon",
    label: "Icon",
    description: "Standalone icon by name",
    group: "Meta",
    stub: `- type: icon
  name: check
  color: green`,
  },
  {
    type: "kbd",
    label: "Keyboard Shortcut",
    description: "Keyboard key combination display",
    group: "Meta",
    stub: `- type: kbd
  keys: [Cmd, S]`,
  },
  {
    type: "meta",
    label: "Meta Fields",
    description: "Key-value metadata display",
    group: "Meta",
    stub: `- type: meta
  fields:
    - label: Owner
      value: "Team Lead"
    - label: Updated
      value: "2026-01-15"`,
  },
  {
    type: "avatar",
    label: "Avatar",
    description: "User avatar with name and subtitle",
    group: "Meta",
    stub: `- type: avatar
  name: Alex Kim
  subtitle: Engineering`,
  },
  {
    type: "avatar_group",
    label: "Avatar Group",
    description: "Row of stacked avatars with overflow count",
    group: "Meta",
    stub: `- type: avatar_group
  avatars:
    - name: Alex Kim
    - name: Sam Lee
  max: 5`,
  },
  {
    type: "definition_list",
    label: "Definition List",
    description: "Term and definition pairs",
    group: "Meta",
    stub: `- type: definition_list
  items:
    - term: API
      definition: "Application Programming Interface"`,
  },
  {
    type: "rule_list",
    label: "Rule List",
    description: "Content rules with pass/fail indicators",
    group: "Meta",
    stub: `- type: rule_list
  items:
    - label: Rule name
      description: "What this rule checks."`,
  },
  {
    type: "breadcrumb",
    label: "Breadcrumb",
    description: "Navigation path breadcrumb trail",
    group: "Meta",
    stub: `- type: breadcrumb
  items:
    - label: Home
      href: /
    - label: Current Page`,
  },
];

export const PALETTE_GROUPS = [
  "Text",
  "Data",
  "Structure",
  "Sequence",
  "Layout",
  "Interactive",
  "Meta",
];
