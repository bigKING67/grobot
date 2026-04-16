# Quality Guidelines

> Quality baseline for backend and platform code in `grobot`.

---

## Overview

Quality gates must protect three dimensions simultaneously:

1. Layer boundary correctness (`models/tools/extensions/orchestration/governance`).
2. Contract correctness (types, runtime events, management payload shape).
3. Operational safety (path safety, redaction, explicit fallback behavior).

---

## Forbidden Patterns

1. Cross-layer leakage (for example runtime execution logic inside gateway orchestration glue).
2. Silent failure paths that hide root causes.
3. Unsafe path handling without workspace boundary checks.
4. Hardcoded secrets/tokens in source.
5. Weak typing workarounds (`any` without strict justification, unchecked casts from `unknown`).
6. Inline dynamic import patterns that bypass static module contracts.

---

## Required Patterns

1. Keep entrypoint files thin; move logic to dedicated modules.
2. Validate and normalize external inputs before business logic.
3. Use canonical shared types from `gateway/src/models/types.ts` and runtime contracts.
4. Emit explicit warnings when fallback/degrade behavior is triggered.
5. Preserve deterministic naming and source tracking fields in status/config payloads.

---

## Verification Requirements

1. After non-doc code changes, run repository check pipeline:
   - `npm run check`
2. For runtime-focused iteration, at minimum confirm Rust compile path:
   - `cargo check --manifest-path runtime/Cargo.toml`
3. For gateway TypeScript compile contract:
   - `npm run check:gateway:ts`
4. For workflow/task context changes:
   - `python3 ./.trellis/scripts/task.py validate <task-dir>`

---

## Code Review Checklist

1. Is the touched file in the correct architecture layer?
2. Are error/fallback paths explicit and observable?
3. Are secrets redacted in logs/status/config outputs?
4. Are storage payloads backward-tolerant and version-aware?
5. Are related docs/contracts updated together with code changes?
6. Is verification evidence attached for the changed layer?

---

## Examples

1. `gateway/src/orchestration/entrypoints/dev-cli/index.ts` (thin command dispatch)
2. `gateway/src/orchestration/entrypoints/dev-cli/services/runtime-paths.ts` (input normalization + path resolution)
3. `gateway/src/orchestration/entrypoints/dev-cli/services/redaction.ts` (safe output surface)
4. `runtime/src/tools/core/mod.rs` (tool context validation + workspace boundary checks)
5. `runtime/src/orchestration/pipeline.rs` (deterministic event lifecycle)
