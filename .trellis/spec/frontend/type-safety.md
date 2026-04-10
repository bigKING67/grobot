# Type Safety

> Frontend type-safety contract for this repository.

---

## Overview

Frontend TS code is not yet present, but type policy is already defined by
repository rules and must be enforced from the first UI commit.

Upgrade trigger: once first UI package compiles, add concrete type examples from
that package in this file.

---

## Type Organization

1. Feature-local types stay close to their feature modules.
2. Cross-layer/shared contracts move to shared `types/` modules.
3. Keep external API DTOs separate from UI view-model types.
4. Co-locate runtime validators with boundary types once validation library is chosen.

---

## Validation

Validation library is not selected yet. Until then:

1. Treat all external input as untrusted at boundaries.
2. Add explicit parsing/guard logic before flowing data into UI state.
3. Avoid relying only on compile-time types for runtime payload safety.
4. Reuse shared contract shapes (`session-key`, `runtime-events`) at boundaries.

---

## Common Patterns

1. Use explicit interfaces/types for component props and hook contracts.
2. Prefer discriminated unions for async state (`idle/loading/success/error`) when appropriate.
3. Use utility types intentionally (`Pick`, `Omit`, etc.) and avoid over-abstracting simple shapes.

---

## Forbidden Patterns

1. `any` unless absolutely necessary and justified in review.
2. Inline type imports such as `import("pkg").Type` in type positions.
3. Dynamic import patterns used only to bypass typing constraints.
4. Broad unsafe assertions that hide validation gaps.
5. Diverging local type aliases from shared cross-layer contract names.

---

## Examples (Current Evidence)

1. `gateway/src/types.ts`: typed turn/event/session-related contracts in the TS layer.
2. `shared/contracts/session-key.md`: canonical session-key field semantics.
3. `.trellis/spec/guides/cross-layer-thinking-guide.md`: contract-first discipline for cross-boundary payloads.
