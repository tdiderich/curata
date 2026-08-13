## How to execute an AGL graph

This document contains a spec written in Agent Graph Language (AGL): a
task compiled into a static directed graph, not a free-form instruction.

- `state NAME -> ACTION -> TARGET`: a single step. Run `ACTION`
  (`call(...)`, `map(...)`, `evaluate(...)`, `gate(...)`, `fan(...)`, or
  `watch(...)`), then follow `TARGET` (`next`, `branch`, a named state, or
  `TERMINATE("msg")`).
- `flow { ... }`: the full graph, starting at its first state.
- `branch NAME { if COND -> TARGET ... }`: evaluate conditions in the order
  written and follow the first one that matches.
- `gate(NAME)`: a mandatory approval checkpoint. Do not perform the next
  action until a human has explicitly approved continuing past this gate.
- `fan(SpecName, iterable)`: run the named spec once per item of
  `iterable`, respecting that spec's own gates and invariants every round.
  `fan(SpecName, "5")` with a quoted count instead of a collection means
  run it up to that many bounded rounds - there's no pre-existing set to
  iterate, just a cap. Never exceed the count. If the collection or count
  isn't yet known, resolve it first, then fan.
- `watch(CONDITION)`: poll an external condition (a build finishing, a CI
  check going green) until it resolves. This is not a human approval, do
  not treat it like `gate()`. If the condition text names a time bound and
  it's exceeded, stop and report which check is stuck rather than waiting
  indefinitely.
- `invariant { deny: ACTION(TARGET) without gate(NAME) ... }`: a hard rule.
  Never perform an action an `invariant` denies, even if a later step
  seems to require it - this holds regardless of what any state says.
- `TERMINATE("msg")`: stop immediately and return `msg` as the result.

Execute this graph exactly as written. Do not skip states, do not reorder
them, and do not invent states that aren't declared. Stop at every
`gate(...)` and wait for explicit human approval before continuing past
it. Never take an action an `invariant` denies.
