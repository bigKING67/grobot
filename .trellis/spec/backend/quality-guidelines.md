# Quality Guidelines

> Quality baseline for current backend/workflow scripts.

---

## Overview

Quality gates apply across Python, TypeScript, and Rust layers in this repo.

Core principles:

1. Read specs before write (`.trellis/spec/*` + task PRD).
2. Keep contracts explicit across gateway/runtime/workflow boundaries.
3. Prefer small, composable modules over monolithic handlers.
4. Verify changed layer(s) with the closest available command-level checks.

---

## Forbidden Patterns

1. Unsafe filesystem operations without path validation.
2. Silent failure paths that hide root causes.
3. Duplicated constants/contracts across modules instead of shared source.
4. Mixing unrelated concerns into one command handler/module.

---

## Required Patterns

1. Type annotations on public/helper functions (Python/TS/Rust signatures).
2. Command functions return explicit exit/result semantics.
3. Shared workflow constants imported from `common/paths.py`.
4. Session/event contracts come from shared contract files, not ad-hoc strings.

---

## Testing Requirements

Current minimum validation:

1. Workflow script changes:
   - run impacted CLI command (`--help` + realistic invocation),
   - run `python3 ./.trellis/scripts/task.py validate <task-dir>` if context touched.
2. Rust runtime changes:
   - run `cargo check` in `runtime/`.
3. Node/TS package changes:
   - run package-level `npm run check` once scripts are defined.

---

## Code Review Checklist

1. Does the change preserve state integrity and path/session safety?
2. Are errors explicit, actionable, and non-silent?
3. Are shared contracts/constants centralized and reused?
4. Are related docs/specs updated in the same change?
5. Is verification evidence attached for the changed layer?

---

## Examples

1. `.trellis/scripts/common/paths.py`: centralized workflow constants/path helpers.
2. `.trellis/scripts/task.py`: command decomposition into `cmd_*` handlers.
3. `gateway/src/types.ts` + `shared/contracts/runtime-events.md`: explicit event/session contract surface.
4. `runtime/Cargo.toml` + `runtime/src/main.rs`: Rust runtime validation baseline via `cargo check`.
