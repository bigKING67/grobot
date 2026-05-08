# Error Handling

> Error-handling conventions across gateway, runtime, and workflow tooling.

---

## Overview

Error handling follows fail-fast plus explicit fallback boundaries:

1. Input/contract violations fail immediately with actionable messages.
2. Recoverable infrastructure failures can degrade mode (for example redis -> file), but must emit warnings.
3. Runtime turn failures must produce normalized failure events (`turn_failed`, then `turn_end` with failed status).

---

## Error Categories

1. Contract/input errors:
   - invalid CLI options, malformed session/model commands, invalid tool arguments.
2. IO/state errors:
   - missing files, unreadable config, redis/runtime process failures.
3. Upstream/provider errors:
   - timeout, auth/HTTP errors, invalid JSON responses.
4. Runtime execution errors:
   - tool disabled, unsupported tool call, interrupted turn, model execution failure.

---

## Handling Patterns

1. Validate and normalize at boundaries (`parse*`, `normalize*`, `resolve*` helpers).
2. Return structured error classes where possible (runtime model/tool error classes).
3. Preserve context in error text (provider, timeout source, trace/class identifiers).
4. Only degrade on explicitly recoverable paths (store backends, config read fallback).
5. Keep user-facing stdout concise, send diagnostics to stderr.

---

## API and Runtime Failure Contracts

1. TS dev CLI command dispatch returns explicit exit codes for unsupported/invalid commands.
2. Management routes should return consistent JSON error envelopes via route helpers.
3. Rust runtime pipeline emits `turn_failed` and terminal `turn_end` events on failure.
4. Stdio runtime client converts JSON-RPC errors into typed, contextual JS errors.

---

## Provider Routing Failure Health Contract

When Rust model/provider execution returns structured failure metadata, gateway
provider routing must treat `error_data` as the primary recovery signal. Message
text is only a legacy fallback.

Implementation points:

1. `runtime/src/models/contracts.rs` emits provider/model `error_data` fields:
   `diagnostic_kind`, `source`, `stage`, `recovery_hint`, `provider`,
   `provider_kind`, `model`, `http_status`, `attempt`, `max_attempts`, and
   `retryable`.
2. `gateway/src/cli/start/session-registry/normalization.ts` persists only safe
   `provider_runtime_states[].last_error_data` summary fields. It must not
   persist `body_preview` or `response_headers`.
3. `gateway/src/cli/start/turn/provider-health.ts` maps
   `SessionProviderRuntimeState.last_error_data` into route health:
   - `retryable=false` -> strong score penalty and sticky bypass when another
     provider is available.
   - `attempt >= max_attempts` -> strong score penalty and sticky bypass when
     another provider is available.
   - `config_missing` / `config_invalid` and auth-like HTTP status
     `401` / `403` / `404` -> strongest penalty.
   - transient HTTP status `408` / `425` / `429` / `500` / `502` / `503` / `504`
     with `retryable=true` -> moderate penalty, not an immediate sticky bypass.
4. `gateway/src/cli/start/turn/provider-routing.ts` must include the health
   penalty in `resolveProviderOrder()` score calculations and expose route
   diagnostics via `RouteDecisionTrace.scoreOrder[].lastErrorPenalty`,
   `RouteDecisionTrace.scoreOrder[].lastErrorReason`, and stderr
   `last_error_penalties=...`.
5. `gateway/src/extensions/contracts/provider-routing-contract.ts` must cover
   retry decisions and route ordering together:
   - non-retryable sticky provider is bypassed when a clean alternate is open;
   - exhausted-attempt sticky provider is bypassed when a clean alternate is
     open;
   - retryable transient provider keeps only moderate penalty and can remain
     selected when it is otherwise the better route;
   - config/auth blockers rank behind clean providers;
   - trace fields include machine-readable penalty reason.

---

## Common Mistakes

1. Swallowing error context (`catch {}` without warning/error output).
2. Returning success after partial write failure.
3. Throwing opaque `Error("failed")` without class/source details.
4. Logging sensitive values while printing debug failures.

---

## Examples

1. `gateway/src/cli/index.ts` (exit-code based command error handling)
2. `gateway/src/tools/runtime/stdio-client.ts` (spawn timeout, abort, JSON-RPC error normalization)
3. `gateway/src/cli/services/session-store.ts` (redis failure fallback)
4. `runtime/src/orchestration/pipeline.rs` (failure-to-event mapping)
5. `runtime/src/models/config.rs` (provider/config parse and upstream error classes)
