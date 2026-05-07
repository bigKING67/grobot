# Quality Guidelines

> Quality baseline for terminal interaction and prompt UX code.

---

## Overview

Frontend quality in `grobot` means:

1. Deterministic command/interaction behavior.
2. Explicit and observable fallback/error paths.
3. Clear separation between pure formatting/parsing and side-effect execution.
4. Strong typed contracts at all interaction boundaries.

---

## Forbidden Patterns

1. Mixing persistence/network side effects into pure parser or formatter functions.
2. Silent fallback behavior without warning output (for example redis -> file fallback without surfaced reason).
3. TTY-only assumptions in command flows that also run in non-interactive contexts.
4. Session switch operations that skip history/runtime synchronization.
5. Hardcoded secrets/tokens in output or source.
6. Weak typing shortcuts (`any`, unchecked JSON casts, ad-hoc object shapes).

---

## Required Patterns

1. Keep entrypoint handlers thin and delegate logic to focused modules (`create*`, `run*`, `build*` patterns).
2. Use explicit result unions for interactive flows (`selected`/`cancelled`, `continue`/`break`).
3. Surface warnings through existing output channels (`writeSessionWarnings`, `writeStoreWarnings`).
4. Keep ask-user interactions resumable with stable identifiers (`questionId`, `resumeToken`, `blockingNodeId`).
5. Provide explicit usage/help text for invalid command shapes.

---

## Verification Requirements

1. After non-doc code changes, run repository checks:
   - `npm run check`
2. For gateway-focused type/contract iteration, confirm:
   - `npm run check:gateway:ts`
3. For select-menu controller behavior, run the focused contract before the
   broader gateway gate:
   - `npx --yes --package tsx@4.20.6 tsx gateway/src/extensions/contracts/start-input-keybinding-contract.ts`
   This must include `select-menu-runtime-contract.ts` flags when changing
   raw-mode ordering, disabled options, inline-input mode, numeric selection,
   or search cancellation.
4. For task workflow/spec updates, validate task metadata:
   - `python3 ./.trellis/scripts/task.py validate <task-dir>`

---

## Code Review Checklist

1. Does each interaction module preserve parse/build/run separation?
2. Are cancellation and non-TTY branches implemented and user-visible?
3. Are state transitions synchronized across runtime + persistence layers?
4. Are fallback/error paths explicit and logged with actionable detail?
5. Are new/changed payload fields normalized at boundaries?
6. Are docs/spec files updated for new interaction contracts?

---

## Examples

1. `gateway/src/cli/start/interactive-handler.ts`
2. `gateway/src/cli/start/session/menu-ops.ts`
3. `gateway/src/cli/tui/components/select-menu/controller.ts`
4. `gateway/src/cli/services/session-store.ts`
5. `gateway/src/tools/ask-user/runtime.ts`
