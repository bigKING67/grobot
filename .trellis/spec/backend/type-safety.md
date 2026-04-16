# Type Safety

> Type contracts and boundary-validation rules for backend code in `grobot`.

---

## Overview

Type safety in this repository must cover three boundaries simultaneously:

1. Gateway TypeScript contracts (compile-time safety for request/response/state shapes).
2. Runtime Rust contracts (typed execution inputs/outputs/errors and serde parsing).
3. Cross-layer protocol compatibility (`runtime.v1`, event names, payload structure).

The goal is to fail early on invalid shape/value while keeping public contracts stable.

---

## Core Principles

1. Prefer explicit contract types over inferred ad-hoc object literals.
2. Treat external input as untrusted (`unknown` / `serde_json::Value`) until validated.
3. Keep error classes and event type names deterministic and machine-readable.
4. Avoid silent coercion (`as any`, lossy cast, unchecked numeric conversion).
5. Update docs/contracts/tests together when a shared type changes.

---

## TypeScript Rules (Gateway)

1. Use canonical types from `gateway/src/models/types.ts` for shared payloads and events.
2. Boundary functions should accept broad input (`Record<string, unknown>`, `unknown`) and normalize via `parse*`/`resolve*` helpers before use.
3. Keep fallback/runtime status represented as unions/discriminated fields, not stringly-typed free-form objects.
4. For generic stores/controllers, constrain payload adapters with explicit generic signatures instead of unchecked casts.
5. Do not introduce `any` unless there is no viable typed alternative and the reason is documented inline.

---

## Rust Rules (Runtime)

1. Prefer domain structs/enums with `Result<T, E>` over ad-hoc tuple/string return patterns.
2. Keep model/tool/orchestration errors in typed structs (`error_class`, `message`, telemetry) and preserve context.
3. Parse JSON payloads step-by-step and return typed errors on missing/invalid fields.
4. Avoid `unwrap()` / `expect()` in production paths; convert failures into typed runtime/tool/model errors.
5. Use explicit serde contracts (`Deserialize`/`Serialize`, `rename`, optional/default handling) for protocol-facing structs.

---

## Cross-Layer Contract Sync

1. When changing runtime request/result/event shape, update both gateway and runtime contracts in the same change.
2. New event names must be added to the TypeScript union (`RuntimeEventType`) and emitted consistently by runtime pipeline.
3. When adding optional fields, maintain backward tolerance (older payload readers must still parse safely).
4. If a type change affects persistence payloads, update load/save adapters and fallback paths together.

---

## Verification

1. Type-level verification:
   - `npm run check:gateway:ts`
   - `cargo check --manifest-path runtime/Cargo.toml`
2. Contract behavior verification:
   - `npm run check`
3. If serialization/parse logic changed, add or update focused tests in the touched module.

---

## Examples

1. `gateway/src/models/types.ts` (canonical cross-layer TS contracts).
2. `gateway/src/orchestration/entrypoints/dev-cli/services/session-store.ts` (generic adapter boundaries and typed fallback state).
3. `runtime/src/models/contracts.rs` (runtime execution contracts and typed model errors).
4. `runtime/src/tools/core/mod.rs` (typed tool errors + serde config parsing).
5. `runtime/src/extensions/contracts.rs` (protocol structs with serde-driven parsing rules).
