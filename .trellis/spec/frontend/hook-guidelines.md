# Hook Guidelines

> Hook conventions to use when frontend stateful logic is added.

---

## Overview

No custom hooks are present yet. Use this file as the baseline for the first
`use*` APIs.

Hook design goal: isolate reusable stateful behavior and keep components
presentation-focused.

Upgrade trigger: once `web-ui/src/hooks/` is added, append at least two real
hook examples with file paths.

---

## Custom Hook Patterns

1. Name hooks with `use*` prefix only when React Hook rules apply.
2. Keep each hook focused on one concern (data load, selection state, polling, etc.).
3. Return a stable shape (data, status, actions) and document nullable/empty states.
4. Avoid hidden global mutation inside hooks.

---

## Data Fetching

Data-fetching library is not fixed yet. Before selecting one:

1. Define request/response contracts in shared types first.
2. Keep transport details out of pure presentational components.
3. Expose loading/error/empty states explicitly from hooks.
4. Keep session identifiers and trace ids first-class in hook outputs when relevant.

For cross-layer flows, align with `.trellis/spec/guides/agent-gateway-runtime-guide.md`.

---

## Naming Conventions

1. `use<Resource>` for server data hooks.
2. `use<Feature><Behavior>` for feature-scoped logic.
3. `use<Domain>Store` naming only if true shared store semantics are used.

---

## Common Mistakes

1. Creating hooks for one-off local behavior that should stay inside a component.
2. Returning ambiguous data shapes without status fields.
3. Coupling hooks directly to UI text/DOM concerns.
4. Parsing session/runtime identifiers inconsistently across hooks.

---

## Examples (Current Evidence)

1. `.trellis/spec/guides/agent-gateway-runtime-guide.md`: runtime contract constraints for data hooks.
2. `.trellis/spec/guides/cross-layer-thinking-guide.md`: required reasoning for gateway/runtime-spanning hooks.
3. `shared/contracts/runtime-events.md`: canonical runtime event shape for event-stream hooks.
