# Type Safety

> Type safety patterns for the CLI/TUI interaction layer.

---

## Overview

Interaction code must preserve strict TypeScript contracts across:

1. Command parsing and dispatch unions.
2. Session/runtime in-memory state objects.
3. Persistence payload normalization (`file`/`redis`).
4. Ask-user envelope parsing and resolution.

---

## Type Organization

1. Keep domain-level interaction types close to their module boundary:
   - Session types in `session-registry.ts` and `session-store.ts`.
   - Ask-user envelope/result types in `tools/ask-user/schema.ts`.
2. Keep module-local input contracts near factory functions (`Create*Input` interfaces).
3. Re-export only stable contracts at module index boundaries (`tools/ask-user/index.ts`).
4. Prefer explicit string unions for mode/result states over free-form strings.

---

## Validation

1. Treat external payloads as `unknown` and normalize before use.
2. Use parse helpers to normalize primitive fields (`parseOptionalString`, `parseOptionalNonNegativeInt`).
3. Use dedicated normalizers for boundary payloads:
   - `normalizeAskUserEnvelope()`
   - `normalizeAskUserEnvelopeFromPayload()`
   - `normalizeSessionRegistryPayload()`
4. Keep fallback defaults explicit when fields are missing (for example question id/resume token generation).

---

## Common Patterns

1. Discriminated unions for interaction outcomes:
   - `TerminalSelectMenuResult`
   - `SessionMenuSelection`
   - `SessionInteractiveAction`
2. Typed runtime interfaces for dependency injection:
   - `RunStartInteractiveModeInput`
   - `AskUserRuntimeAdapter`
3. Option records with typed readers (`OptionValue`, `readOptionString`, `readOptionStringAny`).

---

## Forbidden Patterns

1. `any` as a shortcut for cross-module contracts.
2. Unchecked `as` casts from raw JSON payloads without normalization.
3. Returning shape-unstable objects from factories (missing discriminators or optional semantics).
4. Inline dynamic imports or type workarounds that bypass static dependency contracts.

---

## Examples

1. `gateway/src/cli/start/session-interactive.ts`
2. `gateway/src/cli/tui/components/prompt-input/contract.ts`
3. `gateway/src/cli/start/session-registry.ts`
4. `gateway/src/cli/services/memory-store-config.ts`
5. `gateway/src/tools/ask-user/schema.ts`
