# State Management

> State-management policy for upcoming frontend modules.

---

## Overview

No frontend state library is committed yet. The current policy is decision-first:
classify state shape and lifetime before introducing global tooling.

Upgrade trigger: once real UI state store code lands, replace this bootstrap
policy with concrete library usage patterns and examples.

---

## State Categories

Use four categories:

1. Local UI state:
   component-only interaction state.
2. Feature shared state:
   shared across components in one feature boundary.
3. Server state:
   fetched from gateway/runtime APIs with explicit loading/error status.
4. URL/stateful navigation state:
   route/query driven state that should be shareable/bookmarkable.
5. Session control state:
   active session, selected thread, and turn execution mode (`/mode`) semantics.

---

## When to Use Global State

Promote to global only when at least one of these is true:

1. State is consumed by multiple distant route trees.
2. State must survive local component unmount/remount.
3. State coordinates multiple subsystems (for example, session/workflow dashboards).

Otherwise keep state local or feature-scoped.

---

## Server State

1. Keep request contract types explicit.
2. Cache keys must be deterministic and derived from stable query input.
3. Keep stale/error/loading states explicit in hook/store outputs.
4. Do not blend server truth with speculative UI state without clear separation.
5. Preserve runtime event ordering when deriving UI timeline state.

---

## Common Mistakes

1. Introducing global state too early for local-only concerns.
2. Mixing transport state and display state in one opaque object.
3. Using mutable module-level singletons without lifecycle control.
4. Storing unvalidated external payloads directly in global state.

---

## Examples (Current Evidence)

1. `README.md`: architecture split (TypeScript orchestration + Rust runtime) implies explicit state boundaries.
2. `.trellis/spec/guides/agent-memory-context-guide.md`: memory lifecycle constraints for any future stateful UX.
3. `.trellis/spec/guides/agent-gateway-runtime-guide.md`: session/runtime contracts influencing server-state design.
