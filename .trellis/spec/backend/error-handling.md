# Error Handling

> Error-handling conventions for current Python workflow tooling.

---

## Overview

Error handling follows language- and layer-specific contracts:

1. Python CLI workflow scripts:
   - return `0/1`,
   - print actionable `Error:` messages,
   - exit via `sys.exit(main())`.
2. TypeScript gateway modules:
   - throw typed `Error` with clear context,
   - avoid silent fallbacks.
3. Rust runtime modules:
   - prefer `Result`-based propagation,
   - reserve `panic` for truly unrecoverable programmer errors.

---

## Error Types

Current practical categories:

1. Input/precondition errors:
   missing args, invalid session key format, missing task/developer identity.
2. Filesystem/state errors:
   path not found, unsafe path, read/write failures.
3. Parse/contract errors:
   JSON decode failures, malformed event/session payloads, unsupported values.

Guard clauses + explicit error branching are the dominant pattern.

---

## Error Handling Patterns

1. Guard early, fail fast on contract violations.
2. Catch narrow exception groups where possible.
3. Fallback only where safe:
   config read may fallback, but task/runtime integrity violations must abort.
4. Include enough context in error text to diagnose quickly (key ids/paths/fields).

---

## API Error Responses

Current output contracts:

1. CLI commands:
   human-readable error + non-zero exit.
2. Runtime streams:
   emit failure event (`turn_failed`) when turn cannot complete.
3. Management/API layer (when implemented):
   must define stable JSON error envelope before public exposure.

---

## Common Mistakes

1. Catching broad exceptions without preserving actionable context.
2. Returning success after partial failure.
3. Writing fatal errors to stdout instead of stderr (CLI).
4. Throwing raw string errors without context in gateway modules.

---

## Examples

1. `.trellis/scripts/task.py`: explicit non-zero returns on invalid arguments/state.
2. `.trellis/scripts/common/task_utils.py`: path-safety checks and error-first branching.
3. `gateway/src/session-key.ts`: strict parse/validate and explicit thrown errors for malformed keys.
4. `shared/contracts/runtime-events.md`: `turn_failed` as normalized runtime failure event.
