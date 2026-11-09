# Help videos: one per screen

This was the plan. The `<name>.beats.yaml` files are what the videos are actually built from. Captions were changed during the build wherever the real UI said otherwise: "Trust latest" not "Approve", "Mark complete" not "Checked", comments start from selected text, rules are Block/Review/Guidance, and cleanup has per-row actions rather than multi-select.

The welcome video is a fast montage. Every other video is slower: one feature per beat, 4 to 6 seconds each, a ring on the control being explained, and a caption that says what it does. Each runs 30 to 50 seconds and ends on a card pointing at the two buttons under the player.

Every video gets the same pair of buttons:
- **Copy**: a prompt that has your agent do this screen's job
- **Docs**: a page to read

The docs links go to existing seeded pages where one fits. The rest go to a new seeded page, `using-curata`, with one section per screen.

| Route | Video | Copy button | Docs button |
|---|---|---|---|
| `/dashboard`, `/settings` fallback | welcome (done) | Copy setup prompt for agent | Agent setup instructions |
| `/pages/*/settings` | page-settings | Copy prompt: tidy this page's tags and rules | Using curata |
| `/pages/*` | page | Copy this page for your agent | How pages work (page-structure) |
| `/map` | map | Copy prompt: work the needs-a-look list | Using curata |
| `/map/new` | map-new | Copy prompt: put my key pages on the map | Using curata |
| `/map/*` | map-node | Copy prompt: check this node's pages | Using curata |
| `/review` | review | Copy prompt: summarize my review queue | Using curata |
| `/cleanup` | cleanup | Copy prompt: brain health pass | Brain health workflow |
| `/settings` | settings | Copy setup prompt for agent | Agent setup instructions |

## page: Working with a page (~45s)
Screen: the agent-written page (Demo/Page AgentPage).
1. This is a page. Agents write them; you read, review and share them.
2. (scroll) Pages are built from sections: steps, tables, callouts and code.
3. (ring a section, Comment menu) Comment on any section to leave a note for its author.
4. (ring Edit) Edit changes the page in place. Save when you're done.
5. (ring Copy for agent) Copy for agent hands this page to any agent as context.
6. (Present, Next slide) Present turns each section into a slide.
7. (ring Export PDF) Export PDF gives you a clean copy to send.
8. (ring Page settings) Page settings holds visibility, tags and rules.
9. (ring Hide labels) Hide labels for a slimmer dock. Help is always here.
10. End card: Copy this page for your agent, right below.

## page-settings: Page settings (~35s)
Screen: new story rendering the settings tabs with fixtures.
1. Every page has settings. Most of the time your agent sets them.
2. General: who can see the page and which folder it lives in.
3. Tags: what the page is about. Tags put it on the content map.
4. Content map: the topics this page depends on, and the ones it owns.
5. Rules: checked on every save. Warn rules flag, block rules stop the write.
6. Trust: approve a version so agents read the reviewed one.
7. End card.

## map: Content map (~40s)
Screen: /map with fixture nodes in all three colors.
1. The content map shows what depends on what.
2. (ring a node card) Each card is a page others depend on, with what sits under it.
3. (ring totals) Green is checked, yellow needs a look, red is out of date.
4. (ring tabs) Active is work in flight, Watching is standing pages, Done is shipped.
5. (click List) Needs a look lists every page that may have drifted from its source.
6. (ring Copy all) Copy a prompt and let your agent take the first pass.
7. (ring + Add) Add your own top-level items.
8. End card.

## map-node: A map node (~30s)
Screen: one node with red, yellow and green children.
1. A node is one source page and everything that depends on it.
2. (ring source) When the source changes, everything under it needs a look.
3. (ring a red row) Each row says why: the source moved, or a check is past due.
4. (ring Checked) Mark a row checked once it matches again.
5. (ring copy prompt) Or copy a prompt and have your agent check them all.
6. End card.

## map-new: New map item (~25s)
Screen: the new-item form, typed into.
1. Add anything others depend on: a pricing page, a template, a policy.
2. (type name) Name it.
3. (search source) Point at the page that owns the truth for it.
4. (add dependents) List the pages that depend on it.
5. When the source changes, those pages land in Needs a look.
6. End card.

## review: Review queue (~30s)
Screen: review queue with fixture rows (never trusted, versions behind).
1. The review queue lists agent edits waiting on a person.
2. (ring a row) Each row says why it's here: never approved, or newer edits.
3. (expand diff) Open a row to see exactly what changed.
4. (ring Approve) Approve it, and agents read this version from now on.
5. End card.

## cleanup: Cleanup (~25s)
Screen: cleanup with flagged and archived fixtures.
1. Cleanup is where stale and flagged pages go.
2. (ring flags) Pages your agents or teammates flagged, with the reason.
3. (ring archived) Archived pages stay here until you restore or delete them.
4. (select, bulk bar) Select several and act on them at once.
5. End card.

## settings: Settings (~40s)
Screen: settings tabs with fixtures.
1. Settings for your whole brain.
2. Connect: add agents and get the connection details.
3. Members and Groups: who's in, and what each group can do.
4. Tags: the vocabulary your agents tag pages with.
5. Content Rules: rules checked on every save, across every folder.
6. API Keys: for headless agents and CI.
7. Theme: make it look like yours.
8. End card.

Captions are draft copy. Builders must keep each one true to what its frame shows, and must not use em dashes.
