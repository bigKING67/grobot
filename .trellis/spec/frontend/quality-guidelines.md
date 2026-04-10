# Quality Guidelines

> Frontend quality baseline for the bootstrap phase.

---

## Overview

No frontend package is implemented yet. This file defines quality gates that
must apply immediately when frontend code is introduced.

Upgrade trigger: when first UI package is merged, replace generic checklist
items with package-specific lint/test/build commands and examples.

---

## Forbidden Patterns

1. Skipping spec review and implementing UI contracts from memory.
2. Introducing `any`-heavy data flows without boundary validation.
3. Using inline imports/dynamic type workarounds to bypass type constraints.
4. Shipping UI behavior without keyboard/accessibility parity for interactive elements.
5. Duplicating session/runtime contract literals across components/hooks.

---

## Required Patterns

1. Spec-first development (`frontend/index.md` + relevant guide docs).
2. Explicit typed contracts for props/hooks/state.
3. Clear loading/empty/error UI states for server-bound data views.
4. Cross-layer checks for features touching runtime/gateway/memory flows.
5. Keep UI contract terms aligned with `.grobot/project.toml` and `shared/contracts/*`.

---

## Testing Requirements

When frontend package appears:

1. Run package-level checks defined by the package itself.
2. Follow repo rule: after code changes, run `npm run check` where applicable.
3. Add targeted tests for new behavior (component/hook/state logic) once test harness exists.
4. For event-driven views, verify ordering/replay behavior against runtime event contracts.

Until frontend code exists, keep this section synchronized with actual project tooling.

---

## Code Review Checklist

1. Does the change follow the current frontend spec docs and AGENTS constraints?
2. Are component/hook/state contracts explicit and typed?
3. Are cross-layer assumptions documented and validated?
4. Are accessibility and error/empty states handled intentionally?

---

## Examples (Current Evidence)

1. `.trellis/workflow.md`: mandatory development loop and pre-write spec reading.
2. `.trellis/spec/guides/cross-layer-thinking-guide.md`: required reasoning path for multi-layer frontend features.
3. `.grobot/project.toml` and `shared/contracts/runtime-events.md`: canonical contract terms to mirror in UI implementations.
