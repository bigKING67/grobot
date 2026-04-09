# Cross-Layer Thinking Guide

> Purpose: Prevent local fixes from breaking end-to-end behavior by validating contracts across channel, gateway, runtime, tool, memory, and data layers.

---

## 1. Cross-Layer First Principle

Any change that touches an interface boundary must be analyzed as a flow, not a file.

Typical boundaries:

- Channel adapter -> gateway request schema
- Gateway -> runtime event contract
- Runtime -> tool execution contract
- Runtime -> memory ingestion and recall
- Runtime/gateway -> observability and audit pipeline

---

## 2. End-to-End Flow Map

Before coding, map the exact path:

1. Input shape and trust level
2. Validation and normalization point
3. Contract transformation point
4. Persistence and caching point
5. Output and user-visible side effect

If any step is ambiguous, freeze and define the contract first.

---

## 3. Contract Invariants

Every cross-layer contract should define:

- Required fields and optional fields
- Allowed enum values
- Error code semantics
- Version compatibility policy
- Idempotency and retry behavior

For session systems, also define ordering and cancellation semantics.

---

## 4. Change Impact Matrix

For each planned change, answer:

- Which upstream producers are affected?
- Which downstream consumers are affected?
- Does storage schema need migration?
- Does telemetry schema need update?
- Do eval/replay fixtures need regeneration?

No boundary change should merge without explicit answers.

---

## 5. Failure Mode Analysis

Evaluate at least these failure modes:

- partial timeout (model succeeds, tool fails)
- duplicate delivery (retry on network split)
- stale state (cache/data race)
- schema drift (producer and consumer mismatch)
- policy mismatch (gateway allows, runtime denies)

Define fallback behavior and audit visibility for each.

---

## 6. Observability Requirements

Cross-layer changes must preserve:

- trace continuity (`trace_id` and `turn_id`)
- event completeness (`turn_start` to `turn_end` or `turn_failed`)
- consistent error code propagation
- actionable logs with layer attribution

If observability breaks, rollback risk increases sharply.

---

## 7. Validation Strategy

Minimum validation stack for boundary changes:

1. Contract tests (schema compatibility)
2. Integration test through affected layers
3. Replay test for known historical failures
4. One negative-path test (timeout/invalid input/denied action)

Only unit tests are insufficient for cross-layer modifications.

---

## 8. Common Anti-Patterns

- Fixing UI/API symptoms while leaving runtime contract mismatch unresolved.
- Silent schema extension without version bump or default handling.
- Adding fallback logic that hides root-cause errors.
- Updating one side of a contract and relying on "eventual sync."

---

## 9. Project-Specific Application

In this repository, treat these as high-risk cross-layer changes:

- SessionKey format changes
- Turn event schema changes
- Provider routing policy and failover code changes
- Tool capability model changes
- Memory recall injection format changes

Each requires contract test updates plus trace/eval verification.

