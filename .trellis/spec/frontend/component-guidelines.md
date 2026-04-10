# Component Guidelines

> Component standards to apply when frontend modules are introduced.

---

## Overview

No frontend components exist yet in this repository. These rules define the
minimum contract for the first component implementations.

The priority is consistency with project constraints, not rapid ad-hoc UI code.

Upgrade trigger: once `web-ui/src/components/` appears, replace bootstrap
examples with real in-repo component examples in the same PR.

---

## Component Structure

Each component should follow:

1. `PascalCase` component name.
2. Explicit `Props` type/interface near component definition.
3. Minimal side effects in render path.
4. Feature-specific components near feature boundaries; promote to shared only when reused.

---

## Props Conventions

1. No untyped props.
2. Avoid `any` in props and component internals.
3. Prefer explicit optional fields (`foo?: string`) over broad unions with implicit behavior.
4. Keep prop surfaces small; derive view-only data before passing down.

---

## Styling Patterns

Project-level style system is not established yet. Until then:

1. Pick one styling method per package (for example CSS Modules) and stay consistent.
2. Keep design tokens/theme values centralized once introduced.
3. Avoid inline style sprawl for non-trivial styling logic.

---

## Accessibility

Baseline requirements for first UI modules:

1. Semantic interactive elements (`button`, `a`) instead of generic clickable `div`.
2. Keyboard accessibility for all interactive controls.
3. Clear labels/aria metadata for form-like interactions.

---

## Common Mistakes

1. Building components before route/task boundaries are clear.
2. Over-coupling components to transport/data-fetch details.
3. Adding visual behavior without keyboard/screen-reader parity.
4. Embedding session/runtime contract assumptions in UI without shared contract alignment.

---

## Examples (Current Evidence)

1. `.trellis/spec/frontend/type-safety.md`: type constraints to apply for all component props/events.
2. `.trellis/spec/guides/cross-layer-thinking-guide.md`: component boundary decisions must respect cross-layer contracts.
3. `shared/contracts/session-key.md`: example of domain contract that UI should consume rather than re-invent.
