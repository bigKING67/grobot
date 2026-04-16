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

## Common Mistakes

1. Swallowing error context (`catch {}` without warning/error output).
2. Returning success after partial write failure.
3. Throwing opaque `Error("failed")` without class/source details.
4. Logging sensitive values while printing debug failures.

---

## Examples

1. `gateway/src/orchestration/entrypoints/dev-cli/index.ts` (exit-code based command error handling)
2. `gateway/src/tools/runtime/stdio-client.ts` (spawn timeout, abort, JSON-RPC error normalization)
3. `gateway/src/orchestration/entrypoints/dev-cli/services/session-store.ts` (redis failure fallback)
4. `runtime/src/orchestration/pipeline.rs` (failure-to-event mapping)
5. `runtime/src/models/config.rs` (provider/config parse and upstream error classes)
