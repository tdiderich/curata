# kazam component reference

Auto-generated from schema. Do not edit.

## Enums

### Align
Values: `left`, `right`, `center`

### AnnotationSource
Values: `cli`, `agent`, `web`

### AnnotationStatus
Values: `pending`, `incorporated`, `ignored`, `stale`

### AvatarSize
Values: `sm`, `md`, `lg`, `xl`

### ButtonVariant
Values: `primary`, `secondary`, `ghost`

### CalloutVariant
Values: `info`, `warn`, `success`, `danger`

### ChartKind
Values: `pie`, `bar`, `timeseries`

### ChartOrientation
Values: `vertical`, `horizontal`

### Connector
Values: `none`, `dots_line`, `arrow`

### EventFilter
Values: `all`, `major`

### EventSeverity
Values: `major`, `minor`, `info`

### Glow
Values: `none`, `accent`, `corner`

### IconSize
Values: `xs`, `sm`, `md`, `lg`, `xl`

### Interaction
Values: `single_select`, `multi_select`, `none`

### Mode
Values: `dark`, `light`

### NavLayout
Values: `top`, `sidebar`

### PrintFlow
Values: `slides`, `continuous`, `square`

### RefreshMode
Values: `human`, `auto`, `assisted`

### SemColor
Values: `default`, `green`, `yellow`, `red`, `teal`

### Shell
Values: `standard`, `document`, `deck`

### Texture
Values: `none`, `dots`, `grid`, `grain`, `topography`, `diagonal`

### ThemeName
Values: `dark`, `light`, `red`, `orange`, `yellow`, `green`, `blue`, `indigo`, `violet`

### TimelineStatus
Values: `completed`, `active`, `upcoming`

### TreeFilter
Values: `all`, `incomplete`, `blocked`, `priority`

### TreeStatus
Values: `default`, `completed`, `active`, `blocked`, `priority`, `upcoming`

## Types

### AccordionItem
| Field | Type | Required |
|-------|------|----------|
| components | Component[] | yes |
| title | string | yes |

### Annotation
| Field | Type | Required |
|-------|------|----------|
| added | string | yes |
| author | string | yes |
| id | string | yes |
| section | string | no |
| source | AnnotationSource | yes |
| status | AnnotationStatus | yes |
| text | string | yes |

### AvatarConfig
| Field | Type | Required |
|-------|------|----------|
| name | string | yes |
| src | string | no |

### Badge
| Field | Type | Required |
|-------|------|----------|
| color | SemColor | no |
| label | string | yes |

### BeforeAfterItem
| Field | Type | Required |
|-------|------|----------|
| after | string | yes |
| after_context | string | no |
| before | string | yes |
| title | string | yes |

### BreadcrumbItem
| Field | Type | Required |
|-------|------|----------|
| href | string | no |
| label | string | yes |

### ButtonConfig
| Field | Type | Required |
|-------|------|----------|
| external | boolean | no |
| href | string | yes |
| icon | string | no |
| label | string | yes |
| variant | ButtonVariant | no |

### Card
| Field | Type | Required |
|-------|------|----------|
| badge | Badge | no |
| color | SemColor | no |
| description | string | no |
| href | string | no |
| links | Link[] | no |
| title | string | yes |

### ChartPoint
| Field | Type | Required |
|-------|------|----------|
| color | SemColor | no |
| label | string | yes |
| value | number | yes |

### ChartSeries
| Field | Type | Required |
|-------|------|----------|
| color | SemColor | no |
| label | string | yes |
| points | ChartPoint[] | yes |

### ComparePanel
| Field | Type | Required |
|-------|------|----------|
| eyebrow | string | no |
| stats | CompareStat[] | yes |
| title | string | yes |

### CompareStat
| Field | Type | Required |
|-------|------|----------|
| color | SemColor | no |
| label | string | yes |
| value | string | yes |

### DefinitionItem
| Field | Type | Required |
|-------|------|----------|
| definition | string | yes |
| term | string | yes |

### DriftConfig
| Field | Type | Required |
|-------|------|----------|
| repos | DriftRepo[] | yes |

### DriftRepo
| Field | Type | Required |
|-------|------|----------|
| local | string | no |
| prefix | string | yes |

### EmptyStateAction
| Field | Type | Required |
|-------|------|----------|
| href | string | yes |
| label | string | yes |

### EventItem
| Field | Type | Required |
|-------|------|----------|
| date | string | yes |
| link | string | no |
| severity | EventSeverity | no |
| source | string | no |
| summary | string | no |
| title | string | yes |

### Freshness
| Field | Type | Required |
|-------|------|----------|
| expires | string | no |
| owner | string | no |
| refresh | string | RefreshConfig | no |
| review_every | string | no |
| sources_of_truth | (string | SourceOfTruth)[] | no |
| updated | string | no |

### Link
| Field | Type | Required |
|-------|------|----------|
| href | string | yes |
| label | string | yes |

### MetaField
| Field | Type | Required |
|-------|------|----------|
| key | string | yes |
| value | string | yes |

### NavLink
| Field | Type | Required |
|-------|------|----------|
| children | NavLink[] | no |
| collapsed | boolean | no |
| href | string | no |
| label | string | yes |
| personas | string[] | no |

### Reference
| Field | Type | Required |
|-------|------|----------|
| note | string | no |
| url | string | yes |

### RefreshConfig
| Field | Type | Required |
|-------|------|----------|
| mode | RefreshMode | no |
| steps | RefreshStep[] | no |

### RefreshStep
| Field | Type | Required |
|-------|------|----------|
| prompt | string | no |
| review | string | no |
| run | string | no |

### ResourceItem
| Field | Type | Required |
|-------|------|----------|
| description | string | no |
| href | string | yes |
| owner | string | no |
| title | string | yes |

### Role
| Field | Type | Required |
|-------|------|----------|
| description | string | no |
| href | string | no |
| icon | string | no |
| id | string | yes |
| label | string | yes |

### SelectableCard
| Field | Type | Required |
|-------|------|----------|
| body | string | no |
| bullets | string[] | no |
| color | SemColor | no |
| eyebrow | string | no |
| title | string | yes |

### Slide
| Field | Type | Required |
|-------|------|----------|
| components | Component[] | yes |
| hide_label | boolean | no |
| label | string | yes |

### SourceOfTruth
| Field | Type | Required |
|-------|------|----------|
| href | string | no |
| label | string | yes |

### Stat
| Field | Type | Required |
|-------|------|----------|
| color | SemColor | no |
| detail | string | no |
| label | string | yes |
| value | string | yes |

### Step
| Field | Type | Required |
|-------|------|----------|
| detail | string | no |
| title | string | yes |

### Tab
| Field | Type | Required |
|-------|------|----------|
| components | Component[] | yes |
| label | string | yes |

### TableColumn
| Field | Type | Required |
|-------|------|----------|
| align | Align | no |
| key | string | yes |
| label | string | yes |
| sortable | boolean | no |

### ThemeTokens
| Field | Type | Required |
|-------|------|----------|
| accent | string | yes |
| accent_soft | string | yes |
| bg | string | yes |
| border | string | yes |
| border_strong | string | yes |
| green | string | yes |
| header_border | string | yes |
| overlay_hover | string | yes |
| red | string | yes |
| surface | string | yes |
| surface_strong | string | yes |
| text | string | yes |
| text_muted | string | yes |
| text_subtle | string | yes |
| yellow | string | yes |

### TimelineItem
| Field | Type | Required |
|-------|------|----------|
| name | string | yes |
| status | TimelineStatus | yes |

### TreeNode
| Field | Type | Required |
|-------|------|----------|
| children | TreeNode[] | no |
| label | string | yes |
| note | string | no |
| status | TreeStatus | no |

### ValidationError
| Field | Type | Required |
|-------|------|----------|
| error_type | string | yes |
| file | string | yes |
| message | string | yes |
| path | string | yes |
| suggestion | string | no |

### VennOverlap
| Field | Type | Required |
|-------|------|----------|
| label | string | no |
| sets | number[] | yes |

### VennSet
| Field | Type | Required |
|-------|------|----------|
| color | SemColor | no |
| label | string | yes |

### Voice
| Field | Type | Required |
|-------|------|----------|
| reading_level | string | no |
| terminology | { prefer?: Record<string, string>; avoid?: string[] } | no |
| tone | string | no |

## Components

### accordion
| Field | Type | Required |
|-------|------|----------|
| items | AccordionItem[] | yes |

```yaml
- type: accordion
  items: []
```

### avatar
| Field | Type | Required |
|-------|------|----------|
| name | string | yes |
| size | AvatarSize | no |
| src | string | no |
| subtitle | string | no |

```yaml
- type: avatar
  name: "Example"
  size: "sm"  # optional
  src: "https://example.com"  # optional
```

### avatar_group
| Field | Type | Required |
|-------|------|----------|
| avatars | AvatarConfig[] | yes |
| max | number | no |
| size | AvatarSize | no |

```yaml
- type: avatar_group
  avatars: []
  max: 3  # optional
  size: "sm"  # optional
```

### badge
| Field | Type | Required |
|-------|------|----------|
| color | SemColor | no |
| label | string | yes |

```yaml
- type: badge
  color: "default"  # optional
  label: "Example Title"
```

### before_after
| Field | Type | Required |
|-------|------|----------|
| after_label | string | no |
| before_label | string | no |
| items | BeforeAfterItem[] | yes |

```yaml
- type: before_after
  after_label: "example"  # optional
  before_label: "example"  # optional
  items: []
```

### blockquote
| Field | Type | Required |
|-------|------|----------|
| attribution | string | no |
| body | string | yes |

```yaml
- type: blockquote
  attribution: "example"  # optional
  body: "Description text"
```

### breadcrumb
| Field | Type | Required |
|-------|------|----------|
| items | BreadcrumbItem[] | yes |

```yaml
- type: breadcrumb
  items: []
```

### button_group
| Field | Type | Required |
|-------|------|----------|
| buttons | ButtonConfig[] | yes |

```yaml
- type: button_group
  buttons: []
```

### callout
| Field | Type | Required |
|-------|------|----------|
| body | string | yes |
| links | ButtonConfig[] | no |
| title | string | no |
| variant | CalloutVariant | no |

```yaml
- type: callout
  body: "Description text"
  links: []  # optional
  title: "Example Title"  # optional
```

### card_grid
| Field | Type | Required |
|-------|------|----------|
| cards | Card[] | yes |
| connector | Connector | no |
| min_width | number | no |

```yaml
- type: card_grid
  cards: []
  connector: "none"  # optional
  min_width: 3  # optional
```

### chart
| Field | Type | Required |
|-------|------|----------|
| data | ChartPoint[] | no |
| height | number | no |
| kind | ChartKind | yes |
| orientation | ChartOrientation | no |
| series | ChartSeries[] | no |
| title | string | no |
| x_label | string | no |
| y_label | string | no |

```yaml
- type: chart
  data: []  # optional
  height: 300  # optional
  kind: "pie"
```

### chart_group
| Field | Type | Required |
|-------|------|----------|
| columns | number | no |
| components | Component[] | yes |
| title | string | no |

```yaml
- type: chart_group
  columns: 3  # optional
  components: []
  title: "Example Title"  # optional
```

### code
| Field | Type | Required |
|-------|------|----------|
| code | string | yes |
| language | string | no |

```yaml
- type: code
  code: "console.log('hello')"
  language: "typescript"  # optional
```

### columns
| Field | Type | Required |
|-------|------|----------|
| columns | Component[][] | yes |
| equal_heights | boolean | no |

```yaml
- type: columns
  columns: []
  equal_heights: false  # optional
```

### definition_list
| Field | Type | Required |
|-------|------|----------|
| items | DefinitionItem[] | yes |

```yaml
- type: definition_list
  items: []
```

### divider
| Field | Type | Required |
|-------|------|----------|
| label | string | no |

```yaml
- type: divider
  label: "Example Title"  # optional
```

### embed
| Field | Type | Required |
|-------|------|----------|
| aspect | string | no |
| src | string | yes |
| title | string | no |

```yaml
- type: embed
  aspect: "16:9"  # optional
  src: "https://example.com"
  title: "Example Title"  # optional
```

### empty_state
| Field | Type | Required |
|-------|------|----------|
| action | EmptyStateAction | no |
| body | string | no |
| icon | string | no |
| title | string | yes |

```yaml
- type: empty_state
  action: {}  # optional
  body: "Description text"  # optional
  title: "Example Title"
```

### event_timeline
| Field | Type | Required |
|-------|------|----------|
| default_filter | EventFilter | no |
| events | EventItem[] | yes |
| limit | number | no |
| show_filter_toggle | boolean | no |

```yaml
- type: event_timeline
  default_filter: "all"  # optional
  events: []
  limit: 3  # optional
```

### header
| Field | Type | Required |
|-------|------|----------|
| align | Align | no |
| eyebrow | string | no |
| id | string | no |
| subtitle | string | no |
| title | string | yes |

```yaml
- type: header
  align: "left"  # optional
  eyebrow: "example"  # optional
  title: "Example Title"
```

### hero_banner
| Field | Type | Required |
|-------|------|----------|
| buttons | ButtonConfig[] | no |
| eyebrow | string | no |
| subtitle | string | no |
| title | string | yes |

```yaml
- type: hero_banner
  buttons: []  # optional
  eyebrow: "example"  # optional
  title: "Example Title"
```

### icon
| Field | Type | Required |
|-------|------|----------|
| color | SemColor | no |
| name | string | yes |
| size | IconSize | no |

```yaml
- type: icon
  color: "default"  # optional
  name: "Example"
  size: "xs"  # optional
```

### image
| Field | Type | Required |
|-------|------|----------|
| align | Align | no |
| alt | string | no |
| caption | string | no |
| max_width | number | no |
| src | string | yes |

```yaml
- type: image
  align: "left"  # optional
  alt: "Image description"  # optional
  src: "https://example.com"
```

### kbd
| Field | Type | Required |
|-------|------|----------|
| keys | string[] | yes |

```yaml
- type: kbd
  keys: []
```

### markdown
| Field | Type | Required |
|-------|------|----------|
| body | string | yes |

```yaml
- type: markdown
  body: "Description text"
```

### meta
| Field | Type | Required |
|-------|------|----------|
| fields | MetaField[] | yes |

```yaml
- type: meta
  fields: []
```

### progress_bar
| Field | Type | Required |
|-------|------|----------|
| color | SemColor | no |
| detail | string | no |
| label | string | no |
| value | number | yes |

```yaml
- type: progress_bar
  color: "default"  # optional
  detail: "Description text"  # optional
  value: 42
```

### resources
| Field | Type | Required |
|-------|------|----------|
| items | ResourceItem[] | yes |

```yaml
- type: resources
  items: []
```

### role_map
| Field | Type | Required |
|-------|------|----------|
| title | string | no |

```yaml
- type: role_map
  title: "Example Title"  # optional
```

### section
| Field | Type | Required |
|-------|------|----------|
| align | Align | no |
| components | Component[] | yes |
| eyebrow | string | no |
| heading | string | no |
| id | string | no |

```yaml
- type: section
  align: "left"  # optional
  components: []
  eyebrow: "example"  # optional
```

### selectable_grid
| Field | Type | Required |
|-------|------|----------|
| cards | SelectableCard[] | yes |
| connector | Connector | no |
| interaction | Interaction | no |

```yaml
- type: selectable_grid
  cards: []
  connector: "none"  # optional
  interaction: "single_select"  # optional
```

### split_compare
| Field | Type | Required |
|-------|------|----------|
| left | ComparePanel | yes |
| right | ComparePanel | yes |

```yaml
- type: split_compare
  left: {}
  right: {}
```

### stat_grid
| Field | Type | Required |
|-------|------|----------|
| columns | number | no |
| stats | Stat[] | yes |

```yaml
- type: stat_grid
  columns: 3  # optional
  stats: []
```

### status
| Field | Type | Required |
|-------|------|----------|
| color | SemColor | no |
| label | string | yes |

```yaml
- type: status
  color: "default"  # optional
  label: "Example Title"
```

### steps
| Field | Type | Required |
|-------|------|----------|
| items | Step[] | yes |
| numbered | boolean | no |

```yaml
- type: steps
  items: []
  numbered: false  # optional
```

### table
| Field | Type | Required |
|-------|------|----------|
| columns | TableColumn[] | yes |
| filterable | boolean | no |
| rows | Record<string, unknown>[] | yes |

```yaml
- type: table
  columns: []
  filterable: false  # optional
  rows: []
```

### tabs
| Field | Type | Required |
|-------|------|----------|
| tabs | Tab[] | yes |

```yaml
- type: tabs
  tabs: []
```

### tag
| Field | Type | Required |
|-------|------|----------|
| color | SemColor | no |
| label | string | yes |

```yaml
- type: tag
  color: "default"  # optional
  label: "Example Title"
```

### timeline
| Field | Type | Required |
|-------|------|----------|
| items | TimelineItem[] | yes |

```yaml
- type: timeline
  items: []
```

### tree
| Field | Type | Required |
|-------|------|----------|
| default_collapsed | boolean | no |
| default_filter | TreeFilter | no |
| nodes | TreeNode[] | yes |
| show_filter_toggle | boolean | no |

```yaml
- type: tree
  default_collapsed: false  # optional
  default_filter: "all"  # optional
  nodes: []
```

### venn
| Field | Type | Required |
|-------|------|----------|
| overlaps | VennOverlap[] | no |
| sets | VennSet[] | yes |
| title | string | no |

```yaml
- type: venn
  overlaps: []  # optional
  sets: []
  title: "Example Title"  # optional
```

